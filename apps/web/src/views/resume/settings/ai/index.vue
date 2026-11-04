<script setup>
// 小舟 AI 与编辑器弹窗复用同一份模型设置，绑定和添加状态保持一致。
import AiProviderSettingsContent from "../../editor/toolbar/modules/ai/content.vue";
</script>

<template>
  <SfScrollbar class="h-full bg-sf-page" flush>
    <main class="flex min-h-full w-full flex-col gap-3 p-3 text-sf-text">
      <header class="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold text-sf-text">{{ $t("resumeNavAiSettings") }}</h1>
          <p class="mt-[6px] max-w-3xl text-xs leading-6 text-sf-text-2">
            {{ $t("resumeSettingsModelDescription") }}
          </p>
        </div>
      </header>
      <AiProviderSettingsContent class="min-h-[540px]" />
    </main>
  </SfScrollbar>
</template>
