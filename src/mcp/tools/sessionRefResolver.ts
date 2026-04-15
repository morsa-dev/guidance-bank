export const SESSION_REF_DESCRIPTION =
  "Required unique provider-native session reference for audit logging and traceability. Send the unique id of the current provider conversation, chat, session, or thread for this exact interaction, not a generic placeholder. Prefer a stable provider-prefixed form such as `cursor:<thread-id>`, `codex:<session-id>`, or `claude-code:<session-id>`. If the provider exposes a stable direct chat URL, you may send that instead of the raw id, or include it alongside the id.";

export const resolveAuditSessionRef = (sessionRef: string | null): string | null => {
  const normalizedSessionRef = sessionRef?.trim() ?? null;
  return normalizedSessionRef && normalizedSessionRef.length > 0 ? normalizedSessionRef : null;
};
