export interface ResendSendResult {
  ok: boolean;
  providerId?: string;
  error?: string;
}

/** POST a single email to the Resend API. Never throws — returns a result. */
export async function postResendEmail(
  apiKey: string,
  from: string,
  msg: { to: string; subject: string; html?: string | null; text: string },
): Promise<ResendSendResult> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html ?? undefined,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    const json = (await res.json()) as { id?: string };
    return { ok: true, providerId: json.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
