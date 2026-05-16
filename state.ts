export interface QuestionConfig {
  type: "text" | "choice";
  label: string;
  choices?: string[];
}

export interface PendingSetup {
  guildId: string;
  channelId: string;
  title?: string;
  description?: string;
  buttonName?: string;
  buttonEmoji?: string;
  categoryId?: string;
  supportRoleIds: string[];
  ticketRoleIds: string[];
  questions: QuestionConfig[];
  lastActivity: number;
  setupMessageId?: string;
  addingQuestionType?: "text" | "choice";
}

export interface TicketSession {
  panelId: number;
  guildId: string;
  channelId: string;
  currentIndex: number;
  answers: { questionId: number; answer: string }[];
  questions: Array<{
    id: number;
    type: string;
    label: string;
    choices?: Array<{ label: string; value: string; order: number }>;
  }>;
  lastActivity: number;
  sessionMessageId?: string;
}

const setupState = new Map<string, PendingSetup>();
const ticketSessions = new Map<string, TicketSession>();

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function cleanupOld<T extends { lastActivity: number }>(map: Map<string, T>) {
  const now = Date.now();
  for (const [key, val] of map.entries()) {
    if (now - val.lastActivity > TIMEOUT_MS) {
      map.delete(key);
    }
  }
}

export function getSetupState(userId: string, guildId: string): PendingSetup | undefined {
  cleanupOld(setupState);
  return setupState.get(`${userId}:${guildId}`);
}

export function setSetupState(userId: string, guildId: string, state: PendingSetup) {
  state.lastActivity = Date.now();
  setupState.set(`${userId}:${guildId}`, state);
}

export function clearSetupState(userId: string, guildId: string) {
  setupState.delete(`${userId}:${guildId}`);
}

export function getTicketSession(userId: string): TicketSession | undefined {
  cleanupOld(ticketSessions);
  return ticketSessions.get(userId);
}

export function setTicketSession(userId: string, session: TicketSession) {
  session.lastActivity = Date.now();
  ticketSessions.set(userId, session);
}

export function clearTicketSession(userId: string) {
  ticketSessions.delete(userId);
}
