import { AbortError, prepareContext, type LLM } from "@snowflake/ai";
import { executeToolCall } from "./actor";
import { observe } from "./observer";
import { think } from "./thinker";
import { ToolRegistry } from "./tools";
import type { ChatMessage, ReactConfig } from "./types";

// 通用运行器负责模型与工具循环，业务完成规则由调用方注入。
export const createReactRunner = (model: LLM, config: ReactConfig) => {
    let aborted = false;
    const contextAbort = new AbortController();
    const abortRef: { current: (() => void) | null } = { current: null };
    const registry = new ToolRegistry();
    config.tools.forEach((t) => registry.register(t));

    const abort = () => {
      aborted = true;
      contextAbort.abort();
      abortRef.current?.();
    };

    const run = async (initialMessages: ChatMessage[]): Promise<string> => {
      const maxSteps = config.maxSteps ?? 99;
      // 每次报告修正仍占模型请求轮次，累计修正和相同失败分别计数。
      const finalRetryLimit = config.finalRetryLimit ?? 99;
      const repeatedFailureLimit = config.repeatedFailureLimit ?? 3;
      // 按工具分别记录失败，穿插读取不能清除另一个工具的重复失败。
      const failures = new Map<string, { reason: string /* 相同问题的规范化原因。 */; count: number /* 连续失败次数。 */ }>();
      const recordFailure = (key: string, reason: string) => {
        const normalized = reason.trim().replace(/\s+/g, " ");
        const previous = failures.get(key);
        const count = previous?.reason === normalized ? previous.count + 1 : 1;
        failures.set(key, { reason: normalized, count });
        return count >= repeatedFailureLimit;
      };
      let history: ChatMessage[] = [...initialMessages];
      const traceId = model.observer.createLlmTrace({
        provider: model.provider,
        model: config.model || model.model,
        input: initialMessages,
      });
      let activeRound: { round: number; startTime: number } | null = null;
      let lastIncompleteReason = "";
      let finalRetries = 0;

      // 统一记录每轮结束时间与耗时，异常和取消同样保留本轮数据
      const finishActiveRound = (status: "success" | "error" | "aborted" = "success") => {
        if (!activeRound) return;
        const endTime = Date.now();
        model.observer.recordLlmTraceEvent(traceId, "round_complete", {
          round: activeRound.round,
          startTime: activeRound.startTime,
          endTime,
          durationMs: endTime - activeRound.startTime,
          status,
        });
        activeRound = null;
      };
      // 退出不再请求模型，交给业务层保留已完成结果并说明停止原因。
      const finishIncomplete = async (reason: string) => {
        if (!config.onIncomplete) throw new Error(reason);
        const answer = await config.onIncomplete(reason);
        config.onFinal?.(answer);
        finishActiveRound("error");
        model.observer.finishLlmTrace(traceId, "error", reason);
        return answer;
      };

      try {
        // 打印 ReAct 运行过程，便于观察每一步发生了什么
        console.log("[ReAct] 开始运行，消息数:", initialMessages.length, "最大步数:", maxSteps);

        for (let step = 0; step < maxSteps; step++) {
          if (aborted) throw new AbortError();

          const round = step + 1;
          activeRound = { round, startTime: Date.now() };
          model.observer.recordLlmTraceEvent(traceId, "round_start", { round });
          console.log(`[ReAct] 第 ${round}/${maxSteps} 步 Think`);
          // 每轮推理前只压缩请求历史副本，不修改调用方保存的原始消息。
          if (config.context) {
            history = await prepareContext(history, {
              ...config.context,
              signal: contextAbort.signal,
            });
          }
          if (aborted) throw new AbortError();
          // 宿主可按轮次裁剪工具声明，首轮只发本轮会用到的工具。
          const roundTools = config.resolveTools?.(step) ?? config.tools;
          const result = await think(model, history, {
            tools: roundTools,
            // 仅首轮强制调用宿主指定的起始工具，后续交由 ReAct 决定。
            toolChoice: step === 0 ? config.initialTool : undefined,
            model: config.model,
            thinking: config.thinking,
            abortRef,
            onEvent: config.onEvent,
            onReasoning: config.onReasoning,
            onContent: config.onContent,
            onToken: config.onToken,
            traceId,
          });

          if (aborted) throw new AbortError();

          if (result.reasoning) console.log("[ReAct] 思考:", result.reasoning);
          console.log("[ReAct] 工具调用:", result.toolCalls);

          config.onThink?.(result.reasoning);

          // 无工具调用时，校验任务完成条件后直接返回最终答案。
          if (!result.toolCalls.length) {
            // 最终回答原样交给业务校验：裁切花括号之间的内容会截断含 JSON 片段的普通回答
            const finalAnswer = result.finalAnswer;

            // 业务运行时可依据工具证据拒绝过早收口，反馈仍留在同一个 ReAct 历史中继续处理。
            if (config.beforeFinal) {
              const retryReason = await config.beforeFinal(finalAnswer);
              if (retryReason) {
                lastIncompleteReason = retryReason;
                // 不同问题允许继续修正，相同问题达到上限立即退出。
                finalRetries += 1;
                if (recordFailure("final", retryReason)) {
                  return await finishIncomplete(`同一问题已连续失败 ${repeatedFailureLimit} 次，已停止自动重试：${retryReason}`);
                }
                if (step >= maxSteps - 1 || finalRetries > finalRetryLimit) {
                  return await finishIncomplete(retryReason);
                }
                history.push({ role: "assistant", content: result.finalAnswer });
                history.push({ role: "system", content: retryReason });
                config.onFinalRetry?.(retryReason);
                finishActiveRound();
                continue;
              }
            }

            console.log("[ReAct] 最终答案:", finalAnswer);
            config.onFinal?.(finalAnswer);
            finishActiveRound();
            model.observer.finishLlmTrace(traceId, "success");
            return finalAnswer;
          }

          // 回填 assistant 的工具调用消息
          history.push({
            role: "assistant",
            content: null,
            tool_calls: result.toolCalls,
          });
          model.observer.updateLlmTraceStatus(traceId, "tool_calling");

          for (const toolCall of result.toolCalls) {
            if (aborted) throw new AbortError();

            console.log(
              "[ReAct] 执行工具:",
              toolCall.function.name,
              "参数:",
              toolCall.function.arguments,
            );
            model.observer.recordLlmTraceEvent(traceId, "tool_call", { round, toolCall });
            config.onAct?.(toolCall);
            let raw: unknown;
            try {
              raw = await executeToolCall(registry, toolCall);
            } catch (error) {
              // 工具执行错误交由宿主决定：返回观察值则恢复继续，否则按原错误中断
              const fallback = config.onToolError?.({ toolCall, error: error as Error, tools: config.tools });
              if (fallback === undefined) throw error;
              raw = fallback;
            }
            const observation = observe(toolCall, raw);
            // 观察结果可能包含整份简历，截断打印避免刷屏
            const observePreview =
              observation.content.length > 2000
                ? observation.content.slice(0, 2000) + "..."
                : observation.content;
            console.log(
              "[ReAct] 观察结果(" + observation.content.length + "字符):",
              observePreview,
            );
            model.observer.recordLlmTraceEvent(traceId, "tool_result", { round, observation });
            // 回传从一开始的 ReAct 轮次，供宿主标注观测过程
            config.onObserve?.(observation, round);

            history.push({
              role: "tool",
              content: observation.content,
              tool_call_id: observation.toolCallId,
            });
            // 只识别明确的失败信封，不把普通数据中的空值视为失败。
            const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
            const failure = config.getToolFailure?.(toolCall, raw) || (value && (
              value.accepted === false || value.success === false || value.applied === false ||
              value.status === "failed" || typeof value.error === "string"
            ) ? String(value.error || value.message || value.summary || "工具未能完成操作") : "");
            const failureKey = `tool:${toolCall.function.name}`;
            if (failure) {
              if (recordFailure(failureKey, failure)) {
                return await finishIncomplete(`同一问题已连续失败 ${repeatedFailureLimit} 次，已停止自动重试：${toolCall.function.name}，${failure}`);
              }
            } else failures.delete(failureKey);
          }
          finishActiveRound();
        }

        console.warn("[ReAct] 超出最大步数");
        return await finishIncomplete(lastIncompleteReason || "执行轮次已用完，尚未生成通过校验的最终回答。");
      } catch (error) {
        const message = String((error as any)?.message || "ReAct 执行失败");
        const status = error instanceof AbortError ? "aborted" : "error";
        finishActiveRound(status);
        model.observer.finishLlmTrace(traceId, status, message);
        throw error;
      }
    };

    return { abort, run };
};
