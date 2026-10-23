import { createHmac, timingSafeEqual } from 'node:crypto';

/** Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted(key+value)...)). */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

export function validateTwilioSignature(authToken: string, signature: string | undefined, url: string, params: Record<string, string>): boolean {
  if (!signature) return false;
  const expected = twilioSignature(authToken, url, params);
  const a = Buffer.from(expected), b = Buffer.from(signature);
  if (a.length === b.length && timingSafeEqual(a, b)) return true;
  // Twilio may sign the URL with or without the default port.
  const alt = url.replace(/^(https:\/\/[^/:]+):443\//, '$1/').replace(/^(http:\/\/[^/:]+):80\//, '$1/');
  if (alt !== url) {
    const e2 = Buffer.from(twilioSignature(authToken, alt, params));
    return e2.length === b.length && timingSafeEqual(e2, b);
  }
  return false;
}

export const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function twimlSayHangup(text: string, voice: string, language: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xml(voice)}" language="${xml(language)}">${xml(text)}</Say><Hangup/></Response>`;
}

export function twimlGather(opts: { say: string; action: string; voice: string; language: string; redirect: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" action="${xml(opts.action)}" method="POST" speechTimeout="auto" language="${xml(opts.language)}" actionOnEmptyResult="true"><Say voice="${xml(opts.voice)}" language="${xml(opts.language)}">${xml(opts.say)}</Say></Gather><Redirect method="POST">${xml(opts.redirect)}</Redirect></Response>`;
}

export function twimlRelay(opts: { wsUrl: string; greeting: string; language: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><ConversationRelay url="${xml(opts.wsUrl)}" welcomeGreeting="${xml(opts.greeting)}" language="${xml(opts.language)}" interruptible="any" /></Connect></Response>`;
}

export class TwilioClient {
  constructor(private sid: string, private token: string) {}
  private auth() { return 'Basic ' + Buffer.from(`${this.sid}:${this.token}`).toString('base64'); }
  private async post(path: string, form: Record<string, string | undefined>) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) if (v !== undefined) body.append(k, v);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.sid}${path}`, {
      method: 'POST', headers: { authorization: this.auth(), 'content-type': 'application/x-www-form-urlencoded' }, body,
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${j.message ?? JSON.stringify(j).slice(0, 200)}`);
    return j;
  }
  call(o: { to: string; from: string; url: string; statusCallback: string }) {
    return this.post('/Calls.json', { To: o.to, From: o.from, Url: o.url, Method: 'POST', StatusCallback: o.statusCallback, StatusCallbackMethod: 'POST', StatusCallbackEvent: 'initiated ringing answered completed' } as any);
  }
  hangup(callSid: string) { return this.post(`/Calls/${callSid}.json`, { Status: 'completed' }); }
  sms(o: { to: string; from: string; body: string; statusCallback?: string }) { return this.post('/Messages.json', { To: o.to, From: o.from, Body: o.body, StatusCallback: o.statusCallback }); }
}
