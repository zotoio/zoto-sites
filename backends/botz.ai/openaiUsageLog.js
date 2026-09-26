/**
 * Structured OpenAI usage logging (no prompts, secrets, or response text).
 */

export function usageFromChatCompletion(model, completion) {
    const usage = completion?.usage;
    if (!usage) {
        return null;
    }
    const reasoning =
        usage.completion_tokens_details?.reasoning_tokens ??
        usage.reasoning_tokens ??
        undefined;
    const record = {
        kind: 'chat.completions',
        model,
        prompt_tokens: usage.prompt_tokens ?? 0,
        completion_tokens: usage.completion_tokens ?? 0,
        total_tokens: usage.total_tokens ?? 0,
    };
    if (reasoning !== undefined) {
        record.reasoning_tokens = reasoning;
    }
    return record;
}

export function usageFromImageGenerateParams(params) {
    return {
        kind: 'images.generate',
        model: params.model,
        size: params.size,
        quality: params.quality,
    };
}

export function logOpenAiUsage(record) {
    console.log(JSON.stringify({ event: 'openai_usage', ...record }));
}

export function sumUsageCalls(calls) {
    const totals = {
        prompt_tokens: 0,
        completion_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 0,
        chat_calls: 0,
        image_calls: 0,
    };
    for (const call of calls) {
        if (call.kind === 'chat.completions') {
            totals.chat_calls += 1;
            totals.prompt_tokens += call.prompt_tokens || 0;
            totals.completion_tokens += call.completion_tokens || 0;
            totals.total_tokens += call.total_tokens || 0;
            totals.reasoning_tokens += call.reasoning_tokens || 0;
        } else if (call.kind === 'images.generate') {
            totals.image_calls += 1;
        }
    }
    return totals;
}

export function attachUsageToEditorial(editorials, calls) {
    if (!calls?.length || !editorials?.length) {
        return;
    }
    editorials[0]._openai_usage = {
        calls,
        totals: sumUsageCalls(calls),
    };
}
