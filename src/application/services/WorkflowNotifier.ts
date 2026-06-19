/**
 * WorkflowNotifier — the "next user in the logical line" rule. When a workflow
 * stage completes, the next ROLE is notified to take over. The chain reflects the
 * academic pipeline: data entry → registrar (process) → generate → approve →
 * issue. Editable in one place; methods not listed emit nothing.
 *
 * Called by the host AFTER a task handler succeeds (best-effort — a notification
 * failure never fails the task).
 */
import type { NotificationRepository } from "../../domain/repositories/notifications";

interface Handoff {
  role: string;
  title: (actor: string) => string;
}

const HANDOFF: Record<string, Handoff> = {
  enterResult: {
    role: "REGISTRAR",
    title: (a) => `${a} entered results — ready to process & lock.`,
  },
  lockSemesterResults: {
    role: "REGISTRAR",
    title: (a) =>
      `${a} processed & locked a semester — transcripts can be generated.`,
  },
  generateTranscript: {
    role: "REGISTRAR",
    title: (a) => `${a} generated a transcript (DRAFT) — ready to approve.`,
  },
  generateCertificate: {
    role: "REGISTRAR",
    title: (a) => `${a} generated a certificate (DRAFT) — ready to approve.`,
  },
  approveTranscript: {
    role: "REGISTRAR",
    title: (a) => `${a} approved a document — ready to export & issue.`,
  },
};

export class WorkflowNotifier {
  constructor(private readonly notifications: NotificationRepository) {}

  /** Methods that trigger a handoff (so the host knows which handlers to wrap). */
  methods(): string[] {
    return Object.keys(HANDOFF);
  }

  /** Emit the handoff for a just-completed task. Never throws. */
  async afterTask(method: string, actorId: string): Promise<void> {
    const h = HANDOFF[method];
    if (!h) return;
    try {
      await this.notifications.create({
        recipientRole: h.role,
        title: h.title(actorId),
        actorUserId: actorId,
      });
    } catch {
      /* a notification must never break the underlying task */
    }
  }
}
