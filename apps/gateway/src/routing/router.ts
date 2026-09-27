import type { AIRequest, ContextItem, ProviderCandidate, RoutingDecision, TaskClassification, TaskKind, TaskScore } from '../domain/types.js';

const TASKS: TaskKind[] = ['chat','debug','refactor','architecture','generate','test','docs','explain','performance','security'];

const TASK_WEIGHT: Record<TaskKind, number> = {
  chat: 0.25,
  explain: 0.38,
  docs: 0.4,
  generate: 0.55,
  test: 0.62,
  refactor: 0.68,
  debug: 0.75,
  performance: 0.82,
  architecture: 0.9,
  security: 0.95,
};

type SignalSource = 'prompt' | 'context';
type ScoreState = { score:number; evidence:Set<string>; prompt:number; context:number; explicit:number };
type PromptRule = { task:TaskKind; weight:number; pattern:RegExp; evidence:string; explicit?:boolean };
type ContextRule = { task:TaskKind; weight:number; pattern:RegExp; evidence:string };

/*
 * The classifier is intentionally deterministic in this phase.  The important
 * distinction is between:
 *   1. explicit user intent, and
 *   2. incidental properties of the code that happens to be open.
 *
 * Context can strengthen an intent that is already plausible, but it must not
 * manufacture a task from an unrelated code token such as `.reduce()`.
 */
const PROMPT_RULES: PromptRule[] = [
  { task:'security', weight:1.00, explicit:true, pattern:/\b(security|vulnerabilit(?:y|ies)|cve|exploit|credential|credentials|secret|secrets|password|token leak|auth(?:entication|orization)?|permission|privilege|injection|sanitize|sanitiz(?:e|ation)|xss|csrf|ssrf|private key|api key|access token)\b/i, evidence:'security-related language' },
  { task:'architecture', weight:0.98, explicit:true, pattern:/\b(architecture|system design|design the system|module boundaries|component boundaries|scalab(?:le|ility)|distributed system|service boundaries|monolith|microservice|event[- ]driven|how should (?:i|we) structure|how should (?:i|we) design|project structure|application structure)\b|(?:معماری|طراحی سیستم|ساختار(?:بندی)? پروژه|ساختار برنامه)/i, evidence:'architecture/design language' },
  { task:'performance', weight:0.98, explicit:true, pattern:/\b(performance|optimi[sz]e|optimization|slow|slower|latency|throughput|memory leak|cpu|bottleneck|profil(?:e|ing)|benchmark|faster|speed|efficient|efficiency|resource usage)\b|(?:بهینه|کند|تاخیر|کارایی|سرعت|گلوگاه|مصرف حافظه)/i, evidence:'performance language' },
  { task:'test', weight:1.00, explicit:true, pattern:/\b(unit test|unit tests|integration test|integration tests|write tests|write unit tests|add tests|implement tests|create tests|test coverage|coverage|assert(?:ion)?s?|fixture|mock(?:ing|s)?|test case|testing this|test this)\b|(?:تست|تست واحد|آزمون واحد|یونیت تست|تست یکپارچه|پوشش تست|تست بنویس|تست اضافه)/i, evidence:'testing language' },
  { task:'refactor', weight:0.98, explicit:true, pattern:/\b(refactor|refactoring|clean up|cleanup|tidy up|restructure|simplify|readable|readability|maintainable|maintainability|code quality|extract (?:a )?(?:method|function|class)|rename|rewrite)\b|(?:رفکتور|بازنویسی|ساده(?:سازی)?|تغییر ساختار کد|قابل نگهداری)/i, evidence:'refactoring language' },
  { task:'debug', weight:0.96, explicit:true, pattern:/\b(debug|debugging|bug|error|exception|stack trace|failing|fails|failed|failure|crash|crashes|broken|doesn['’]t work|does not work|not working|unexpected behavior|unexpected result|what(?:'s| is) wrong|why is this happening|why (?:does|is|isn['’]t|doesn['’]t)|what causes|fix this|fix it|fix that|repair this|repair it|solve this|solve it|resolve this|resolve it|make this work)\b|(?:دیباگ|خطا|ارور|باگ|استثنا|کرش|خراب|کار نمی(?:کند|کنه)|مشکل|چرا)/i, evidence:'debugging/problem language' },
  { task:'docs', weight:0.96, explicit:true, pattern:/\b(write|update|add|generate) (?:the )?(?:documentation|docs|readme)|\bdocument(?:ation)?\b|\breadme\b|\bapi documentation\b|(?:مستندات|راهنما|README)/i, evidence:'documentation language' },
  { task:'explain', weight:0.94, explicit:true, pattern:/\b(explain|explanation|what does (?:this|the) (?:code|function|class|method)|what does this do|how does (?:this|the) (?:code|function|class|method) work|walk me through|why does this work)\b|(?:توضیح بده|توضیح دهید|این کد چیکار|چطور کار می(?:کند|کنه))/i, evidence:'explanation language' },
  { task:'generate', weight:0.94, explicit:true, pattern:/(?!.*\b(?:unit|integration)?\s*tests?\b)\b(implement|generate|create|write|add|build)\b.*\b(code|function|method|class|endpoint|api|feature|implementation|handler|service)\b|\bwrite code\b|\bimplement this\b|\bcreate this function\b|(?:پیاده(?:سازی)? کن|ایجاد کن|بنویس|کد بنویس|اضافه کن)/i, evidence:'code generation language' },
];

const CONTEXT_RULES: ContextRule[] = [
  { task:'debug', weight:0.58, pattern:/\b(throw new|catch\s*\(|stack trace|exception|console\.error|logger\.error|TODO|FIXME|undefined|null|NaN|\.reduce\s*\(|\.map\s*\(|await\b|Promise\.|try\s*\{)/i, evidence:'debug-relevant code patterns' },
  { task:'test', weight:0.42, pattern:/\b(describe|it|test|expect|assert|beforeEach|afterEach|pytest|unittest|jest|vitest|xunit|nunit|junit)\b/i, evidence:'test-framework/code patterns' },
  { task:'architecture', weight:0.42, pattern:/\b(interface|implements|module|controller|service|repository|dependency injection|event bus|message broker|queue|adapter|facade)\b/i, evidence:'architectural code patterns' },
  { task:'security', weight:0.48, pattern:/\b(auth|authorize|permission|role|jwt|oauth|csrf|cors|cookie|password|secret|token|sanitize|escape|sql|query)\b/i, evidence:'security-sensitive code patterns' },
  { task:'performance', weight:0.42, pattern:/\b(cache|redis|memoize|worker|thread|parallel|async|batch|pagination|index|query|database|n\s*\+\s*1)\b/i, evidence:'performance-relevant code patterns' },
];

function languageFromContext(context: ContextItem[], prompt: string): string {
  const counts = new Map<string, number>();
  for (const item of context) {
    const ext = item.path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    const language = ext === 'ts' || ext === 'tsx' ? 'typescript'
      : ext === 'js' || ext === 'jsx' ? 'javascript'
      : ext === 'py' ? 'python'
      : ext === 'java' ? 'java'
      : ext === 'cs' ? 'csharp'
      : ext === 'go' ? 'go'
      : ext === 'rs' ? 'rust'
      : ext === 'sql' ? 'sql'
      : ext === 'json' ? 'json'
      : ext === 'md' ? 'markdown'
      : ext ?? 'unknown';
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  if (counts.size) return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? 'unknown';
  return /[\u0600-\u06ff]/.test(prompt) ? 'fa' : 'en';
}

function addScore(scores: Map<TaskKind, ScoreState>, task:TaskKind, weight:number, evidence:string, source:SignalSource, explicit=false): void {
  const current = scores.get(task) ?? {score:0,evidence:new Set<string>(),prompt:0,context:0,explicit:0};
  current.score = Math.min(1.8, current.score + weight);
  current.evidence.add(evidence);
  current[source] += weight;
  if (explicit) current.explicit += weight;
  scores.set(task,current);
}

function contextQuality(context: ContextItem[]): number {
  if (!context.length) return 0;
  const chars = context.reduce((sum,item)=>sum + item.content.length,0);
  const codeItems = context.filter(item => /\.(ts|tsx|js|jsx|py|java|cs|go|rs|cpp|h|sql)$/i.test(item.path)).length;
  return Math.min(1, (codeItems / context.length) * 0.55 + Math.min(chars / 12000, 1) * 0.45);
}

function hasCodeContext(context: ContextItem[]): boolean {
  return context.some(item => /\.(ts|tsx|js|jsx|py|java|cs|go|rs|cpp|h|sql)$/i.test(item.path));
}

function hasActiveSelection(context: ContextItem[]): boolean {
  return context.some(item => item.reason === 'active selection');
}

function hasAny(p:string, pattern:RegExp): boolean {
  return pattern.test(p);
}

function addConversationalSignals(scores: Map<TaskKind, ScoreState>, p:string, codeContext:boolean): void {
  if (!codeContext) return;

  // Vague developer language. These are intentionally context-gated because
  // "This is ugly" without code is ordinary conversation, not a refactor job.
  if (hasAny(p,/\b(this|it|that)\s+(?:is|looks)\s+(?:ugly|messy|dirty|confusing|clunky|awkward|hard to read)\b/i)) {
    addScore(scores,'refactor',0.86,'code-context + code-quality complaint','prompt',true);
  }
  if (hasAny(p,/\b(?:make|made)\s+(?:this|it)\s+(?:cleaner|simpler|better|more readable|more maintainable|easier to maintain)\b/i)) {
    addScore(scores,'refactor',0.90,'code-context + maintainability request','prompt',true);
  }
  if (hasAny(p,/\b(?:can|could)\s+(?:this|it)\s+be\s+(?:made|rewritten|structured)\s+(?:cleaner|simpler|better|more readable)\b/i)) {
    addScore(scores,'refactor',0.92,'code-context + improvement question','prompt',true);
  }
  if (hasAny(p,/\bhow\s+should\s+(?:i|we)\s+(?:improve|clean up|restructure|simplify)\s+(?:this|it|the code|the function)\b/i)) {
    addScore(scores,'refactor',0.90,'code-context + improvement question','prompt',true);
  }
  if (hasAny(p,/\b(?:i\s+)?(?:don['’]t|do not)\s+like\s+(?:how\s+)?(?:this|it)\s+is\s+structured\b/i)) {
    addScore(scores,'refactor',0.94,'code-context + structure complaint','prompt',true);
  }
  if (hasAny(p,/\b(?:review|clean up|tidy up)\s+(?:this|it|the code)\b/i)) {
    addScore(scores,'refactor',0.82,'code-context + cleanup/review request','prompt',true);
  }

  if (hasAny(p,/\b(?:this|it)\s+(?:is|seems|looks)\s+(?:slow|broken|wrong|weird|strange|buggy)\b/i)) {
    const task = /\bslow\b/i.test(p) ? 'performance' : 'debug';
    addScore(scores,task,0.86,'code-context + problem statement','prompt',true);
  }
  if (hasAny(p,/\b(?:can|could)\s+(?:this|it)\s+be\s+(?:faster|optimized|more efficient)\b/i)) {
    addScore(scores,'performance',0.92,'code-context + performance request','prompt',true);
  }
  if (hasAny(p,/\b(?:how|what)\s+can\s+(?:i|we)\s+do\s+to\s+(?:speed|speed up|improve the performance)\b/i)) {
    addScore(scores,'performance',0.88,'code-context + performance question','prompt',true);
  }

  if (hasAny(p,/\b(?:can|could)\s+(?:you|we)\s+test\s+(?:this|it)\b/i)) {
    addScore(scores,'test',0.88,'code-context + testing request','prompt',true);
  }
}

function suppressCompetingSignals(scores: Map<TaskKind, ScoreState>, p:string): void {
  const damp = (task:TaskKind, factor:number) => {
    const state=scores.get(task);
    if (state) state.score *= factor;
  };
  const performancePrimary = /\b(?:slow|slower|faster|performance|latency|throughput|optimi[sz]e|efficient|bottleneck|memory leak)\b/i.test(p);
  const testingPrimary = /\b(?:test|tests|testing|coverage|assert|fixture|mock)\b|(?:تست|آزمون واحد|یونیت تست|تست یکپارچه|پوشش تست)/i.test(p);
  const securityPrimary = /\b(?:security|vulnerabilit|credential|secret|password|token|injection|xss|csrf|ssrf|auth|permission)\b/i.test(p);
  const refactorPrimary = /\b(?:refactor|refactoring|clean(?:er|up)?|tidy|restructure|simplify|readable|maintainable|rewrite|improve|ugly|messy|code quality|structured)\b/i.test(p);
  const fixPrimary = /\b(?:fix|repair|solve|resolve|bug|error|exception|crash|not working|doesn['’]t work)\b/i.test(p);

  if (performancePrimary) damp('debug',0.48);
  if (testingPrimary) { damp('debug',0.50); damp('generate',0.55); }
  if (securityPrimary) { damp('debug',0.55); damp('refactor',0.60); damp('performance',0.60); }
  if (refactorPrimary && !fixPrimary) damp('debug',0.58);
  if (fixPrimary && refactorPrimary) damp('refactor',0.72);
  if (fixPrimary && performancePrimary) damp('debug',0.48);
}

function addContextGateEvidence(scores: Map<TaskKind, ScoreState>, p:string, codeContext:boolean): void {
  if (!codeContext) return;
  const gated = [
    [/\b(this|it|that)\s+(?:is|looks)\s+(?:ugly|messy|dirty|confusing|clunky|awkward|hard to read)\b/i,'refactor','active code context makes the quality complaint actionable'],
    [/\b(?:make|made)\s+(?:this|it)\s+(?:cleaner|simpler|better|more readable|more maintainable|easier to maintain)\b/i,'refactor','active code context makes the maintainability request actionable'],
    [/\b(?:can|could)\s+(?:this|it)\s+be\s+(?:made|rewritten|structured)\s+(?:cleaner|simpler|better|more readable)\b/i,'refactor','active code context makes the improvement question actionable'],
    [/\bhow\s+should\s+(?:i|we)\s+(?:improve|clean up|restructure|simplify)\s+(?:this|it|the code|the function)\b/i,'refactor','active code context makes the improvement question actionable'],
    [/\b(?:i\s+)?(?:don['’]t|do not)\s+like\s+(?:how\s+)?(?:this|it)\s+is\s+structured\b/i,'refactor','active code context makes the structure complaint actionable'],
    [/\b(?:this|it)\s+(?:is|seems|looks)\s+(?:slow|broken|wrong|weird|strange|buggy)\b/i,'debug','active code context identifies the problem target'],
    [/\b(?:can|could)\s+(?:this|it)\s+be\s+(?:faster|optimized|more efficient)\b/i,'performance','active code context identifies the performance target'],
  ] as const;
  for (const [pattern,task,evidence] of gated) {
    if (pattern.test(p)) addScore(scores,task,0.14,evidence,'context');
  }
}

function applyIntentResolution(scores: Map<TaskKind, ScoreState>, p:string, codeContext:boolean): void {
  const state = (task:TaskKind) => scores.get(task)!;
  const boost = (task:TaskKind, amount:number, evidence:string) => addScore(scores,task,amount,evidence,'prompt',true);

  // Specific domains outrank generic diagnosis language. "This is slow,
  // can you fix it?" is a performance task, not an arbitrary debug task.
  if (state('performance').explicit > 0 && /\b(?:slow|latency|throughput|faster|performance|optimi[sz]e|efficient)\b/i.test(p)) {
    boost('performance',0.22,'performance intent outranks generic fix language');
  }

  // A request to create tests is testing, even when the implementation words
  // also contain "function", "write", or "fix".
  if (state('test').explicit > 0 && /\b(?:test|tests|testing|coverage|assert|fixture|mock)\b/i.test(p)) {
    boost('test',0.20,'testing intent outranks generic code-action language');
  }

  // Security-specific requests outrank generic debugging/refactoring terms.
  if (state('security').explicit > 0 && /\b(?:security|vulnerabilit|credential|secret|password|token|injection|xss|csrf|ssrf|auth|permission)\b/i.test(p)) {
    boost('security',0.20,'security intent outranks generic task language');
  }

  // Explicit refactoring verbs and quality/maintainability language outrank
  // incidental debug patterns in the code context.
  if (state('refactor').explicit > 0 && /\b(?:refactor|clean(?:er|up)?|tidy|restructure|simplify|readable|maintainable|rewrite|improve|code quality|structured|ugly|messy)\b/i.test(p)) {
    boost('refactor',0.18,'refactoring intent outranks incidental code failures');
  }

  // Explicit implementation requests are generation, not chat, even when the
  // requested artifact happens to contain test/error terminology.
  if (state('generate').explicit > 0 && /\b(?:implement|create|generate|write|build|add)\b/i.test(p) && !state('test').explicit) {
    boost('generate',0.14,'implementation intent outranks conversational fallback');
  }

  // Vague questions with code need context to become developer tasks. Without
  // code, retain chat rather than pretending we know what "this" refers to.
  if (codeContext && !state('debug').explicit && !state('refactor').explicit && !state('performance').explicit && !state('test').explicit && !state('explain').explicit && !state('generate').explicit && !state('architecture').explicit && !state('security').explicit && !state('docs').explicit) {
    if (/\b(?:what does this do|what is this|how does this work)\b/i.test(p)) boost('explain',0.82,'code-context + vague explanation request');
    else if (/\b(?:what is wrong|why|what happened|does this work|is this correct)\b/i.test(p)) boost('debug',0.72,'code-context + vague diagnostic question');
    else if (/\b(?:better|cleaner|simpler|readable|maintainable|ugly|messy|improve)\b/i.test(p)) boost('refactor',0.74,'code-context + vague quality request');
  }

  // Compound requests: preserve the primary action instead of letting a
  // secondary phrase win simply because its regex happened to be longer.
  if (codeContext && /\b(?:fix|repair|solve|resolve)\b/i.test(p) && /\b(?:cleaner|clean up|maintainable|readable|refactor|restructure)\b/i.test(p)) {
    boost('debug',0.10,'compound request primary action=fix');
  }
}

export function classify(prompt:string, context: ContextItem[] = []): TaskClassification {
  const p = prompt.trim();
  const scores = new Map<TaskKind, ScoreState>();
  for (const task of TASKS) scores.set(task,{score:0,evidence:new Set<string>(),prompt:0,context:0,explicit:0});

  for (const rule of PROMPT_RULES) {
    if (rule.pattern.test(p)) addScore(scores,rule.task,rule.weight,rule.evidence,'prompt',Boolean(rule.explicit));
  }

  const codeContext = hasCodeContext(context);
  addConversationalSignals(scores,p,codeContext);

  const questionShape = /\?|\b(why|how|what|when|where|which|can you tell me)\b/i.test(p);
  const failureShape = /\b(empty|fail|fails|failed|failure|broken|wrong|unexpected|crash|error|exception|doesn['’]t work|does not work|not working)\b/i.test(p);

  // Natural diagnostic questions that contain no explicit debug verb.
  if (questionShape && failureShape) addScore(scores,'debug',0.34,'failure-oriented question','prompt');

  // Context is supporting evidence. It is only applied when the prompt is
  // already asking for a compatible kind of work. This prevents `.reduce()` or
  // `undefined` from turning every code request into debug.
  const contextWeight = questionShape || /\b(?:this|it|that|code|function|class|method)\b/i.test(p) ? 0.24 : 0;
  if (contextWeight > 0) {
    for (const item of context) {
      const relevance = Math.max(0.5,Math.min(1,item.score));
      for (const rule of CONTEXT_RULES) {
        if (!rule.pattern.test(item.content)) continue;
        const taskState = scores.get(rule.task)!;
        const promptAlreadySupportsTask = taskState.prompt > 0;
        const compatibleVaguePrompt = rule.task === 'debug' && failureShape
          || rule.task === 'test' && /\b(?:test|tests|testing|coverage)\b/i.test(p)
          || rule.task === 'security' && /\b(?:security|credential|secret|password|token|auth|permission|injection)\b/i.test(p)
          || rule.task === 'performance' && /\b(?:slow|faster|performance|latency|optimi[sz]e|efficient)\b/i.test(p)
          || rule.task === 'architecture' && /\b(?:structure|architecture|design|module|service)\b/i.test(p)
          || rule.task === 'explain' && /\b(?:explain|what does|how does|walk me through)\b/i.test(p);
        if (promptAlreadySupportsTask || compatibleVaguePrompt) {
          addScore(scores,rule.task,rule.weight * contextWeight * relevance,rule.evidence,'context');
        }
      }
    }
  }

  if (codeContext && failureShape && questionShape) addScore(scores,'debug',0.62,'code context + failure-oriented question','context');
  if (codeContext && hasActiveSelection(context) && /\b(?:explain|what does|how does|walk me through)\b/i.test(p)) {
    addScore(scores,'explain',0.18,'active code selection','context');
  }

  addContextGateEvidence(scores,p,codeContext);
  applyIntentResolution(scores,p,codeContext);
  suppressCompetingSignals(scores,p);

  const scored: TaskScore[] = [...scores.entries()]
    .map(([task,value])=>({task,score:Number(Math.min(1,value.score).toFixed(4)),evidence:[...value.evidence]}))
    .sort((a,b)=>b.score-a.score);

  const top = scored[0];
  const second = scored[1];
  const topValue = top?.score ?? 0;
  const secondValue = second?.score ?? 0;
  const noSignals = topValue === 0;

  // Resolve common competing intents explicitly. This is deliberately separate
  // from raw score sorting: a phrase such as "slow, can you fix it?" contains
  // both performance and debug vocabulary, but the user is describing a
  // performance problem. Likewise, "implement tests" is testing, not generic
  // generation. Deterministic precedence makes the router stable and testable.
  let task: TaskKind = noSignals ? 'chat' : (top?.task ?? 'chat');
  const explicit = (kind:TaskKind) => scores.get(kind)?.explicit ?? 0;
  if (explicit('security') > 0 && /\b(?:security|vulnerabilit|credential|secret|password|token|injection|xss|csrf|ssrf|auth|permission)\b/i.test(p)) task='security';
  else if (explicit('test') > 0 && /\b(?:test|tests|testing|coverage|assert|fixture|mock)\b|(?:تست|تست واحد|آزمون واحد|یونیت تست|تست یکپارچه|پوشش تست|تست بنویس|تست اضافه)/i.test(p)) task='test';
  else if (explicit('performance') > 0 && /\b(?:slow|slower|faster|performance|latency|throughput|optimi[sz]e|efficient|bottleneck|memory leak)\b/i.test(p)) task='performance';
  else if (explicit('architecture') > 0 && /\b(?:architecture|system design|service boundaries|project structure|application structure|how should (?:i|we) structure)\b/i.test(p)) task='architecture';
  else if (explicit('docs') > 0 && /\b(?:documentation|docs|readme|document)\b/i.test(p)) task='docs';
  else if (explicit('explain') > 0 && /\b(?:explain|what does|how does|walk me through)\b/i.test(p) && !/\b(?:fail|fails|failed|failure|error|exception|bug|broken|not working|doesn['’]t work|what is wrong)\b/i.test(p)) task='explain';
  else if (explicit('generate') > 0 && /\b(?:implement|create|generate|write|build|add)\b/i.test(p) && explicit('test') === 0) task='generate';
  else if (explicit('refactor') > 0 && /\b(?:refactor|refactoring|clean|cleanup|tidy|restructure|simplify|cleaner|readable|maintainable|rewrite|improve|ugly|messy|code quality|structured)\b/i.test(p) && !/\b(?:fix|repair|solve|resolve|bug|error|exception|crash|not working|doesn['’]t work)\b/i.test(p)) task='refactor';

  const taskState = scores.get(task)!;
  const source: TaskClassification['source'] = noSignals ? 'prompt'
    : taskState.prompt > 0 && taskState.context > 0 ? 'hybrid'
    : taskState.context > 0 ? 'context' : 'prompt';

  const separation = Math.max(0,topValue-secondValue);
  const absolute = Math.min(1,topValue);
  const ambiguityPenalty = secondValue >= 0.78 && separation < 0.12 ? 0.10 : secondValue >= 0.65 && separation < 0.18 ? 0.05 : 0;
  const rawConfidence = noSignals
    ? 0.55
    : Math.min(0.98,Math.max(0.50,0.56 + absolute * 0.28 + Math.min(separation,0.55) * 0.26 - ambiguityPenalty));
  const contextDependent = source === 'hybrid' && (task === 'debug' || task === 'refactor' || task === 'performance' || task === 'test' || task === 'explain');
  const confidence = Number(Math.min(contextDependent ? 0.92 : 0.98,rawConfidence).toFixed(2));
  const complexity = Number(Math.min(1,0.12 + Math.min(p.length / 3500,0.28) + TASK_WEIGHT[task] * 0.38 + contextQuality(context) * 0.22 + (context.length > 1 ? 0.05 : 0)).toFixed(4));

  return {
    task,
    complexity,
    confidence,
    language: languageFromContext(context,p),
    source,
    evidence: scored.find(x=>x.task===task)?.evidence ?? [],
    scores: scored,
  };
}

function contextChars(request: AIRequest): number {
  return request.context?.reduce((n,x)=>n+x.content.length,0) ?? 0;
}

function capabilityFit(candidate: ProviderCandidate, request: AIRequest): number {
  const contextSize = contextChars(request);
  if (contextSize > candidate.capabilities.maxContextTokens * 4) return 0;

  let fit = 0.62;
  if (request.context?.length) fit += candidate.capabilities.files ? 0.10 : 0.02;
  if (request.task === 'security' && candidate.capabilities.tools) fit += 0.15;
  if (request.task === 'performance' && candidate.capabilities.tools) fit += 0.08;
  if (request.context?.some(x => /\.(png|jpg|jpeg|gif)$/i.test(x.path))) fit += candidate.capabilities.vision ? 0.20 : -0.35;
  if (request.maxOutputTokens && request.maxOutputTokens > 0) fit += candidate.capabilities.streaming ? 0.05 : 0;
  return Math.max(0,Math.min(1,fit));
}

function complexityFit(candidate: ProviderCandidate, signals: TaskClassification): number {
  if (signals.complexity < 0.35) return 0.82;
  if (signals.complexity < 0.55) return 0.90;
  if (signals.complexity < 0.75) return candidate.capabilities.maxContextTokens >= 32768 ? 0.96 : 0.82;
  return candidate.capabilities.maxContextTokens >= 65536 ? 1 : candidate.capabilities.maxContextTokens >= 32768 ? 0.90 : 0.70;
}

export function route(request:AIRequest,candidates:ProviderCandidate[],signals=classify(request.prompt,request.context ?? [])):RoutingDecision {
  if(request.modelOverride){
    const hit=candidates.find(c=>c.id===request.modelOverride && c.health.healthy && contextChars(request) <= c.capabilities.maxContextTokens * 4);
    if(hit)return {providerId:hit.id,reasons:['explicit user override'],candidates:[{...hit,score:1,reasons:['explicit user override']}],overridden:true};
  }

  const usable=candidates.filter(c=>c.health.healthy && contextChars(request) <= c.capabilities.maxContextTokens * 4);
  const ranked=usable.map(c=>{
    const taskFit = Math.max(0,Math.min(1,c.taskStrengths?.[signals.task] ?? (c.transport === 'local' && request.privacy === 'strict' ? 0.8 : 0.65)));
    const capability = capabilityFit(c,request);
    const reliability=Math.max(0,1-(c.health.latencyMs/5000));
    const complexity=complexityFit(c,signals);
    const privacyBonus=c.transport==='local'&&request.privacy==='strict'?0.10:0;
    const confidenceBonus=signals.confidence * 0.05;
    const score=Number(Math.min(1,0.40*taskFit+0.22*capability+0.12*reliability+0.12*complexity+0.11+privacyBonus+confidenceBonus).toFixed(4));
    return {...c,score,reasons:[
      `task=${signals.task}`,
      `taskFit=${taskFit.toFixed(2)}`,
      `capabilityFit=${capability.toFixed(2)}`,
      `complexityFit=${complexity.toFixed(2)}`,
      `reliability=${reliability.toFixed(2)}`,
      `complexity=${signals.complexity.toFixed(2)}`,
      `confidence=${signals.confidence.toFixed(2)}`,
      `latency=${c.health.latencyMs}ms`,
      ...(privacyBonus ? ['privacy=local-preferred'] : []),
    ]};
  }).sort((a,b)=>b.score-a.score);

  const chosen=ranked[0];
  if(!chosen) throw new Error('No healthy provider supports the current request context');
  return {
    providerId:chosen.id,
    reasons:chosen.reasons,
    candidates:ranked,
    overridden:false,
  };
}
