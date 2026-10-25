import type { ChatLanguage } from "./chatCopy";

export type ChatTaskIcon = "standup" | "today" | "week" | "compare" | "focus" | "drift" | "project";

/** A ready-made request: a short title shown as the question, a fuller prompt sent to the agent. */
export type ChatTask = {
  readonly id: string;
  readonly icon: ChatTaskIcon;
  readonly title: string;
  readonly description: string;
  readonly prompt: string;
};

export type ChatTaskContext = {
  /** Active project names on this computer, in the user's own order. Never leaves the device until a task is sent. */
  readonly projectNames?: readonly string[];
};

const MAX_PROJECT_NAME_CHARS = 40;

function projectName(context: ChatTaskContext): string | null {
  const name = context.projectNames?.map((value) => value.replace(/\s+/g, " ").trim()).find(Boolean) ?? null;
  if (!name) return null;
  return name.length <= MAX_PROJECT_NAME_CHARS ? name : name.slice(0, MAX_PROJECT_NAME_CHARS - 1) + "…";
}

/** Every task in menu order. The empty chat shows the first six. */
export function chatTasks(lang: ChatLanguage, context: ChatTaskContext = {}): ChatTask[] {
  const project = projectName(context);
  if (lang === "ko") {
    return [
      {
        id: "standup", icon: "standup", title: "어제 스탠드업", description: "어제 한 일 · 이어갈 일 · 막힌 점",
        prompt: "어제 기록으로 스탠드업 노트를 써줘. '어제 한 일 / 오늘 이어갈 일 / 막힌 점' 세 부분에 짧은 불릿으로만 써 줘. 이어갈 일과 막힌 점은 기록에서 보이는 것만 적고, 없으면 '기록에 없음'이라고 써 줘.",
      },
      {
        id: "today", icon: "today", title: "오늘 지금까지", description: "지금까지 한 일을 시간순으로",
        prompt: "오늘 지금까지 한 일을 시간순으로 정리해줘. 비슷한 일은 하나로 묶고 각 묶음에 걸린 시간을 적어 줘.",
      },
      {
        id: "week-review", icon: "week", title: "이번 주 회고", description: "가장 많이 한 일과 집중 흐름",
        prompt: "이번 주(월요일부터 오늘까지) 회고를 써줘. 가장 많이 한 일 세 가지, 집중이 잘 된 날과 흐트러진 날, 다음 주에 바꿔 볼 점 하나를 기록 근거로 짧게 써 줘.",
      },
      {
        id: "week-compare", icon: "compare", title: "지난주와 비교", description: "집중 시간과 많이 쓴 앱의 변화",
        prompt: "이번 주를 지난주의 같은 요일까지와 비교해줘. 집중 시간, 딴짓 시간, 가장 많이 쓴 앱이 어떻게 달라졌는지 알려 줘.",
      },
      {
        id: "focus-peak", icon: "focus", title: "가장 집중한 시간", description: "이번 주 집중이 길었던 때",
        prompt: "이번 주에 가장 오래 이어서 집중한 시간대와 그때 한 일을 알려줘.",
      },
      project
        ? {
          id: "project", icon: "project", title: project + " 작업 시간", description: "이번 주 " + project + "에 쓴 시간",
          prompt: "이번 주에 " + project + " 프로젝트 작업을 얼마나 했는지, 주로 어떤 일에 썼는지 알려줘.",
        }
        : {
          id: "project", icon: "project", title: "프로젝트별 시간", description: "이번 주 프로젝트마다 쓴 시간",
          prompt: "이번 주 프로젝트별로 시간을 얼마나 썼는지 정리해줘.",
        },
      {
        id: "drift", icon: "drift", title: "딴짓이 많았던 곳", description: "딴짓으로 분류된 앱과 사이트",
        prompt: "이번 주에 딴짓으로 분류된 시간이 가장 많았던 앱과 사이트를 알려줘.",
      },
      {
        id: "yesterday", icon: "today", title: "어제 하루", description: "어제 기록 요약",
        prompt: "어제 뭐 했는지 요약해줘.",
      },
    ];
  }
  const english = englishTasks(project);
  const text = TASK_TEXT[lang];
  if (!text) return english;
  return english.map((task) => {
    const [title, description] = task.id === "project"
      ? (project ? text.project(project) : text.projects)
      : text[task.id as TaskTextId];
    return { ...task, title, description };
  });
}

type TaskTextId = "standup" | "today" | "week-review" | "week-compare" | "focus-peak" | "drift" | "yesterday";
type TaskText = Readonly<Record<TaskTextId, readonly [string, string]>> & {
  readonly projects: readonly [string, string];
  readonly project: (name: string) => readonly [string, string];
};

/**
 * Titles and descriptions for the app's other display languages. Their fuller
 * requests stay in English; the instructions ask for the reply in the user's language.
 */
const TASK_TEXT: Partial<Record<ChatLanguage, TaskText>> = {
  es: {
    standup: ["Standup de ayer", "Hecho · siguiente · bloqueos"],
    today: ["Hoy hasta ahora", "Lo que hiciste, en orden"],
    "week-review": ["Resumen de la semana", "Lo principal y tu ritmo de concentración"],
    "week-compare": ["Comparar con la semana pasada", "Concentración y apps más usadas"],
    "focus-peak": ["Cuándo me concentré más", "La concentración más larga de la semana"],
    projects: ["Tiempo por proyecto", "Esta semana, proyecto a proyecto"],
    project: (name) => ["Tiempo en " + name, "Esta semana en " + name],
    drift: ["Dónde me distraje", "Apps y sitios marcados como distracción"],
    yesterday: ["Ayer", "Resumen de ayer"],
  },
  ja: {
    standup: ["昨日のスタンドアップ", "やったこと · 次にやること · 困っていること"],
    today: ["今日のここまで", "今日やったことを時系列で"],
    "week-review": ["今週の振り返り", "多く取り組んだことと集中の流れ"],
    "week-compare": ["先週と比べる", "集中時間とよく使ったアプリ"],
    "focus-peak": ["一番集中した時間", "今週いちばん長く集中したとき"],
    projects: ["プロジェクト別の時間", "今週のプロジェクトごとの時間"],
    project: (name) => [name + " の作業時間", "今週の " + name],
    drift: ["気晴らしが多かったところ", "気晴らしに分類されたアプリとサイト"],
    yesterday: ["昨日の一日", "昨日の記録のまとめ"],
  },
  "pt-BR": {
    standup: ["Standup de ontem", "Feito · próximo · bloqueios"],
    today: ["Hoje até agora", "O que você fez, em ordem"],
    "week-review": ["Resumo da semana", "Principais atividades e ritmo de foco"],
    "week-compare": ["Comparar com a semana passada", "Tempo de foco e apps mais usados"],
    "focus-peak": ["Quando mais me concentrei", "O foco mais longo da semana"],
    projects: ["Tempo por projeto", "Esta semana, projeto a projeto"],
    project: (name) => ["Tempo em " + name, "Esta semana em " + name],
    drift: ["Onde me distraí", "Apps e sites marcados como distração"],
    yesterday: ["Ontem", "Resumo de ontem"],
  },
  "zh-Hans": {
    standup: ["昨天的站会", "已完成 · 下一步 · 阻碍"],
    today: ["今天到目前为止", "按时间顺序看你做了什么"],
    "week-review": ["本周回顾", "主要工作和专注节奏"],
    "week-compare": ["和上周比较", "专注时间和最常用的应用"],
    "focus-peak": ["最专注的时候", "本周最长的专注时段"],
    projects: ["按项目统计时间", "本周每个项目的时间"],
    project: (name) => [name + " 的时间", "本周在 " + name + " 上的时间"],
    drift: ["在哪里分心最多", "被归为分心的应用和网站"],
    yesterday: ["昨天", "昨天的记录摘要"],
  },
  fr: {
    standup: ["Standup d’hier", "Fait · à suivre · blocages"],
    today: ["Aujourd’hui jusqu’ici", "Ce que vous avez fait, dans l’ordre"],
    "week-review": ["Bilan de la semaine", "Activités principales et rythme de concentration"],
    "week-compare": ["Comparer à la semaine dernière", "Temps de concentration et apps les plus utilisées"],
    "focus-peak": ["Mon moment le plus concentré", "La plus longue concentration de la semaine"],
    projects: ["Temps par projet", "Cette semaine, projet par projet"],
    project: (name) => ["Temps sur " + name, "Cette semaine sur " + name],
    drift: ["Où je me suis distrait", "Apps et sites classés en distraction"],
    yesterday: ["Hier", "Résumé d’hier"],
  },
  de: {
    standup: ["Standup von gestern", "Erledigt · als Nächstes · Hindernisse"],
    today: ["Heute bisher", "Was du gemacht hast, der Reihe nach"],
    "week-review": ["Wochenrückblick", "Wichtigste Arbeit und Fokusverlauf"],
    "week-compare": ["Mit letzter Woche vergleichen", "Fokuszeit und meistgenutzte Apps"],
    "focus-peak": ["Wann ich am konzentriertesten war", "Der längste Fokus dieser Woche"],
    projects: ["Zeit pro Projekt", "Diese Woche, Projekt für Projekt"],
    project: (name) => ["Zeit für " + name, "Diese Woche für " + name],
    drift: ["Wo ich abgelenkt war", "Als Ablenkung markierte Apps und Websites"],
    yesterday: ["Gestern", "Zusammenfassung von gestern"],
  },
};

function englishTasks(project: string | null): ChatTask[] {
  return [
    {
      id: "standup", icon: "standup", title: "Yesterday's standup", description: "Done · next · blockers",
      prompt: "Write a standup note from yesterday's records with three parts: Yesterday / Today / Blockers, short bullets only. List next steps and blockers only when the records show them; otherwise write \"Not in the records\".",
    },
    {
      id: "today", icon: "today", title: "Today so far", description: "What you did, in order",
      prompt: "Summarize what I did today so far in time order. Group similar work and give each group its time.",
    },
    {
      id: "week-review", icon: "week", title: "This week in review", description: "Top work and focus pattern",
      prompt: "Write a short review of this week (Monday through today): the three things I spent most time on, my most and least focused days, and one thing to change next week, all based on the records.",
    },
    {
      id: "week-compare", icon: "compare", title: "Compare with last week", description: "Focus time and top apps",
      prompt: "Compare this week with last week up to the same weekday: focus time, drift time and how my most used apps changed.",
    },
    {
      id: "focus-peak", icon: "focus", title: "When I focused most", description: "This week's longest focus",
      prompt: "When was my longest stretch of focus this week, and what was I working on?",
    },
    project
      ? {
        id: "project", icon: "project", title: "Time on " + project, description: "This week on " + project,
        prompt: "How much did I work on the " + project + " project this week, and on what?",
      }
      : {
        id: "project", icon: "project", title: "Time by project", description: "This week, project by project",
        prompt: "Break down my time this week by project.",
      },
    {
      id: "drift", icon: "drift", title: "Where I drifted", description: "Apps and sites marked drift",
      prompt: "Which apps and sites took the most drift time this week?",
    },
    {
      id: "yesterday", icon: "today", title: "Yesterday", description: "A summary of yesterday",
      prompt: "What did I do yesterday?",
    },
  ];
}

/** Tasks whose title or description contains every word of the query (the text after "/"). */
export function filterChatTasks(tasks: readonly ChatTask[], query: string): ChatTask[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...tasks];
  return tasks.filter((task) => {
    const haystack = (task.title + " " + task.description).toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

const SUGGESTION_BLOCK = /\n?[ \t]*\u0060\u0060\u0060suggestions[ \t]*\n([\s\S]*?)\n?[ \t]*\u0060\u0060\u0060[ \t]*$/i;
const OPEN_SUGGESTION_FENCE = /(^|\n)[ \t]*\u0060\u0060\u0060suggestions\b[\s\S]*$/i;
const MAX_SUGGESTIONS = 3;
const MAX_SUGGESTION_CHARS = 80;

/** Split the trailing suggestions block the instructions ask for from the answer itself. */
export function splitAnswerSuggestions(text: string): { readonly answer: string; readonly suggestions: string[] } {
  const trimmed = text.trimEnd();
  const match = SUGGESTION_BLOCK.exec(trimmed);
  if (!match) return { answer: visibleAnswerText(text), suggestions: [] };
  const answer = trimmed.slice(0, match.index).trimEnd();
  let suggestions: string[] = [];
  try {
    const parsed: unknown = JSON.parse(match[1].trim());
    if (Array.isArray(parsed)) {
      suggestions = parsed
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.replace(/\s+/g, " ").trim())
        .filter((value) => value.length > 0 && value.length <= MAX_SUGGESTION_CHARS);
    }
  } catch {
    suggestions = [];
  }
  return { answer, suggestions: [...new Set(suggestions)].slice(0, MAX_SUGGESTIONS) };
}

/** Text without a suggestions block, finished or still being written (even a half-typed fence). */
export function visibleAnswerText(text: string): string {
  const withoutBlock = text.replace(OPEN_SUGGESTION_FENCE, "").trimEnd();
  const lastBreak = withoutBlock.lastIndexOf("\n");
  const lastLine = withoutBlock.slice(lastBreak + 1).trim().toLowerCase();
  if (lastLine.startsWith("\u0060") && "\u0060\u0060\u0060suggestions".startsWith(lastLine)) {
    return withoutBlock.slice(0, Math.max(0, lastBreak)).trimEnd();
  }
  return withoutBlock;
}

