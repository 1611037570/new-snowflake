<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { JobMatchReport, JobMatchRequirement } from "@snowflake/resume-agent";

const props = defineProps<{
  report: JobMatchReport; // 已完成结构与原文校验的分析报告。
}>();
// 只统计有据的要求条数，不将其包装为录用概率。
const statuses: Record<JobMatchRequirement["status"], { label: string /* 状态名称。 */; color: string /* 主题状态样式。 */ }> = {
  matched: { label: "有明确证据", color: "bg-sf-success-2 text-sf-success" },
  partial: { label: "部分有据", color: "bg-sf-warning-2 text-sf-warning" },
  missing: { label: "简历未体现", color: "bg-sf-bg text-sf-text-2" },
  unknown: { label: "需要核实", color: "bg-sf-info-2 text-sf-info" },
};
const priorities = { required: "明确要求", preferred: "加分项", responsibility: "职责重点" };
const counts = computed(() => (Object.keys(statuses) as JobMatchRequirement["status"][]).map((key) => ({
  key, // 用于稳定渲染的状态标识。
  ...statuses[key],
  count: props.report.requirements.filter((item) => item.status === key).length, // 对应要求数量。
})));
const activeStatus = ref<JobMatchRequirement["status"] | "all">("all");
// 先呈现明确要求中的差距，同优先级保持报告原始顺序。
const requirementRank = (item: JobMatchRequirement) =>
  (item.status === "matched" ? 6 : 0) + (item.priority === "required" ? 0 : item.priority === "responsibility" ? 2 : 4);
const visibleRequirements = computed(() => props.report.requirements
  .filter((item) => activeStatus.value === "all" || item.status === activeStatus.value)
  .slice().sort((left, right) => requirementRank(left) - requirementRank(right)));
const requiredGaps = computed(() => props.report.requirements.filter((item) => item.priority === "required" && item.status !== "matched").length);
// 新报告恢复完整视图，避免沿用上次筛选后误以为结果缺失。
watch(() => props.report, () => { activeStatus.value = "all"; });
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3">
    <header class="rounded-xl border border-sf-b bg-sf-primary p-3">
      <h2 class="text-sm font-semibold">岗位适配分析</h2>
      <p class="mt-3 whitespace-pre-wrap text-sm leading-6 text-sf-text-2">{{ report.summary }}</p>
      <div class="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <button v-for="item in counts" :key="item.key" type="button" class="cursor-pointer rounded-xl border p-3 text-left transition-colors" :class="[item.color, activeStatus === item.key ? 'border-sf-theme' : 'border-transparent hover:border-sf-b']" :aria-pressed="activeStatus === item.key" @click="activeStatus = activeStatus === item.key ? 'all' : item.key"><strong class="text-lg">{{ item.count }}</strong><span class="ml-3 text-xs">{{ item.label }}</span></button>
      </div>
      <p class="mt-3 text-xs leading-6 text-sf-text-3">以下依据本次简历和岗位说明判断。简历未体现的内容仍需本人确认。</p>
      <ul v-if="report.notices?.length" class="mt-3 space-y-3 text-xs leading-6 text-sf-warning"><li v-for="notice in report.notices" :key="notice">{{ notice }}</li></ul>
      <p v-if="requiredGaps" class="mt-3 text-xs leading-6 text-sf-warning">优先核实 {{ requiredGaps }} 项明确要求中的证据缺口；定制表达无法补足尚未确认的事实。</p>
    </header>
    <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-sf-text-2"><span>显示 {{ visibleRequirements.length }} / {{ report.requirements.length }} 项 · 明确要求中的差距优先</span><button v-if="activeStatus !== 'all'" type="button" class="cursor-pointer text-sf-theme" @click="activeStatus = 'all'">查看全部要求</button></div>
    <p v-if="!visibleRequirements.length" class="rounded-xl border border-sf-b bg-sf-primary p-3 text-sm text-sf-text-2">当前报告没有这一状态的要求，可切换其他状态或查看全部。</p>
    <section v-for="item in visibleRequirements" :key="`${item.priority}-${item.requirement}-${item.jdQuote}`" class="rounded-xl border border-sf-b bg-sf-primary p-3">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <h3 class="min-w-0 flex-1 text-sm font-semibold">{{ item.requirement }}</h3>
        <span class="rounded-lg px-3 py-1 text-xs" :class="statuses[item.status].color">{{ statuses[item.status].label }}</span>
      </header>
      <p class="mt-3 text-xs leading-6 text-sf-text-3">{{ priorities[item.priority] }} · 岗位原文</p>
      <blockquote class="mt-3 whitespace-pre-wrap break-words rounded-lg bg-sf-bg p-3 text-xs leading-6 text-sf-text-2">{{ item.jdQuote }}</blockquote>
      <template v-if="item.evidence">
        <p class="mt-3 text-xs leading-6 text-sf-text-3">简历依据</p>
        <blockquote class="mt-3 whitespace-pre-wrap break-words border-l-2 border-sf-theme pl-3 text-xs leading-6 text-sf-text-2">{{ item.evidence }}</blockquote>
      </template>
      <p class="mt-3 whitespace-pre-wrap text-sm leading-6">{{ item.explanation }}</p>
      <p class="mt-3 whitespace-pre-wrap text-xs leading-6 text-sf-theme">建议：{{ item.action }}</p>
    </section>
    <section v-if="report.strengths.length" class="rounded-xl border border-sf-b bg-sf-primary p-3">
      <h2 class="text-sm font-semibold">值得突出的优势</h2>
      <ul class="mt-3 list-disc space-y-3 pl-3 text-sm leading-6 text-sf-text-2"><li v-for="item in report.strengths" :key="item">{{ item }}</li></ul>
    </section>
    <section v-if="report.questions.length" class="rounded-xl border border-sf-b bg-sf-primary p-3">
      <h2 class="text-sm font-semibold">待补充与核实</h2>
      <ul class="mt-3 list-disc space-y-3 pl-3 text-sm leading-6 text-sf-text-2"><li v-for="item in report.questions" :key="item">{{ item }}</li></ul>
    </section>
  </div>
</template>
