export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-quo-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export type JsonObject = Record<string, unknown>;

export type NormalizedQuoMessage = {
  id: string;
  conversationId: string | null;
  phoneNumberId: string | null;
  direction: "inbound" | "outbound";
  sender: "customer" | "agent";
  from: string | null;
  to: string[];
  text: string;
  media: unknown[];
  status: string | null;
  createdAt: string;
};

export type NormalizedQuoConversation = {
  id: string | null;
  customerName: string | null;
  customerNumber: string | null;
  phoneNumberId: string | null;
  phoneNumberDisplay: string | null;
  phoneNumberName: string | null;
};

export type NormalizedQuoContact = {
  id: string | null;
  name: string | null;
  phoneNumbers: string[];
};


export function jsonResponse(body: JsonObject, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export function normalizePhone(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\+[1-9]\d{1,14}$/.test(trimmed)) return trimmed;

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15 && /^[1-9]/.test(digits)) {
    return `+${digits}`;
  }

  return trimmed;
}

export function summarizeQuoMedia(media: unknown[] | null | undefined) {
  if (!Array.isArray(media) || media.length === 0) return null;

  let images = 0;
  let videos = 0;
  let audio = 0;

  media.forEach((item) => {
    const mediaItem = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const type = String(mediaItem.type ?? mediaItem.contentType ?? mediaItem.mime_type ?? mediaItem.mimeType ?? "").toLowerCase();
    const url = String(mediaItem.url ?? mediaItem.src ?? "").toLowerCase();
    if (type.includes("video") || /\.(mp4|mov|webm)(\?|$)/.test(url)) videos += 1;
    else if (type.includes("audio") || /\.(mp3|wav|m4a)(\?|$)/.test(url)) audio += 1;
    else images += 1;
  });

  const parts = [];
  if (images) parts.push(`${images} ${images === 1 ? "picture" : "pictures"}`);
  if (videos) parts.push(`${videos} ${videos === 1 ? "video" : "videos"}`);
  if (audio) parts.push(`${audio} ${audio === 1 ? "audio" : "audios"}`);
  return parts.join(", ");
}

export function getQuoMessagePreview(text: string | null | undefined, media: unknown[] | null | undefined) {
  const trimmed = text?.trim();
  if (trimmed) return trimmed.slice(0, 200);
  return summarizeQuoMedia(media) ?? "No message preview";
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function arrayOfStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

const processableCallEvents = new Set([
  "call.completed",
  "call.recording.completed",
  "call.transcript.completed",
  "call.summary.completed",
]);

export function isProcessableQuoWebhookEvent(eventType: string) {
  return eventType.startsWith("message.") || processableCallEvents.has(eventType) || eventType === "contact.updated";
}


function extractTranscript(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item: unknown) => {
      const v = typeof item === "object" && item !== null ? item as JsonObject : null;
      if (v && typeof v.content === "string") {
        const speaker = v.userId ? "Agent" : "Customer";
        return `${speaker}: ${v.content}`;
      }
      return "";
    }).filter(Boolean).join("\n");
  }
  return null;
}

function pickCallText(call: JsonObject, data: JsonObject, eventType: string) {
  const summary =
    asString(call.summary) ??
    asString(call.callSummary) ??
    asString(call.aiSummary) ??
    asString(data.summary);
  const dataObject = (data.object && typeof data.object === "object" ? data.object : null) as JsonObject | null;
  const transcript =
    extractTranscript(call.transcript) ??
    extractTranscript(call.transcriptText) ??
    extractTranscript(data.transcript) ??
    extractTranscript(call.voicemailTranscript) ??
    extractTranscript(data.voicemailTranscript) ??
    extractTranscript(call.dialogue) ??
    extractTranscript(dataObject?.dialogue);
  const duration =
    asString(call.duration) ??
    asString(call.durationSeconds) ??
    asString(data.duration);

  const parts = [];

  if (summary) {
    parts.push(`Call summary: ${summary}`);
  } else if (eventType === "call.summary.completed") {
    parts.push("Call summary completed.");
  }
  
  if (transcript) {
    parts.push(`Call transcript: ${transcript}`);
  } else if (eventType === "call.transcript.completed") {
    parts.push("Call transcript completed.");
  }

  if (parts.length > 0) {
    return parts.join("\n\n");
  }

  if (eventType === "call.recording.completed") return "Call recording completed.";
  return duration ? `Call completed. Duration: ${duration}` : "Call completed.";
}

export function normalizeQuoContactPayload(payload: JsonObject): NormalizedQuoContact {
  const data = (payload.data && typeof payload.data === "object" ? payload.data : payload) as JsonObject;
  const dataObject = (data.object && typeof data.object === "object" ? data.object : null) as JsonObject | null;
  const contact = ((data.contact && typeof data.contact === "object"
    ? data.contact
    : dataObject?.object === "contact" || dataObject?.phoneNumbers || dataObject?.phone_numbers
      ? dataObject
      : data) ?? {}) as JsonObject;
  const rawPhoneNumbers = Array.isArray(contact.phoneNumbers)
    ? contact.phoneNumbers
    : Array.isArray(contact.phone_numbers)
      ? contact.phone_numbers
      : [];
  const phoneNumbers = rawPhoneNumbers
    .map((item) => {
      if (typeof item === "string") return normalizePhone(item);
      if (item && typeof item === "object") {
        const phone = item as JsonObject;
        return normalizePhone(asString(phone.value) ?? asString(phone.phoneNumber) ?? asString(phone.phone_number));
      }
      return null;
    })
    .filter((item): item is string => Boolean(item));

  const directPhone =
    normalizePhone(asString(contact.phoneNumber) ?? asString(contact.phone_number) ?? asString(data.phoneNumber) ?? asString(data.phone_number));
  if (directPhone && !phoneNumbers.includes(directPhone)) phoneNumbers.push(directPhone);

  return {
    id: asString(contact.id),
    name: asString(contact.name) ?? asString(contact.fullName) ?? asString(contact.full_name),
    phoneNumbers,
  };
}

function normalizeQuoCallPayload(payload: JsonObject, eventType: string) {
  const data = (payload.data && typeof payload.data === "object" ? payload.data : payload) as JsonObject;
  const dataObject = (data.object && typeof data.object === "object" ? data.object : null) as JsonObject | null;
  const call = ((data.call && typeof data.call === "object"
    ? data.call
    : dataObject?.object === "call" || dataObject?.conversationId || dataObject?.conversation_id
      ? dataObject
      : data) ?? {}) as JsonObject;
  const conversation = ((data.conversation && typeof data.conversation === "object"
    ? data.conversation
    : payload.conversation && typeof payload.conversation === "object"
      ? payload.conversation
      : call.conversation && typeof call.conversation === "object"
        ? call.conversation
        : {}) ?? {}) as JsonObject;

  const callId = asString(call.id) ?? asString(dataObject?.callId) ?? asString(call.callId);
  const conversationId =
    asString(conversation.id) ??
    asString(call.conversationId) ??
    asString(call.conversation_id);

  if (!callId) {
    throw new Error("Invalid Quo call payload: missing call id.");
  }
  
  if (!conversationId && !eventType.includes("transcript") && !eventType.includes("summary")) {
    throw new Error("Invalid Quo call payload: missing conversation id.");
  }

  const rawDirection = asString(call.direction)?.toLowerCase();
  const direction = rawDirection === "outbound" || rawDirection === "outgoing" ? "outbound" : "inbound";
  const sender = direction === "inbound" ? "customer" : "agent";
  const to = arrayOfStrings(call.to);
  const from = asString(call.from);
  const contact = (conversation.contact && typeof conversation.contact === "object"
    ? conversation.contact
    : call.contact && typeof call.contact === "object"
      ? call.contact
      : {}) as JsonObject;
  const phoneNumbers = Array.isArray(contact.phoneNumbers) ? contact.phoneNumbers : [];
  const firstPhone = phoneNumbers[0] && typeof phoneNumbers[0] === "object" ? phoneNumbers[0] as JsonObject : {};
  const phoneNumberId =
    asString(call.phoneNumberId) ??
    asString(call.phone_number_id) ??
    asString(conversation.phoneNumberId) ??
    null;
  const recordingUrl =
    asString(call.recordingUrl) ??
    asString(call.recording_url) ??
    asString(data.recordingUrl) ??
    null;

  const normalizedMessage: NormalizedQuoMessage = {
    id: `${callId}:${eventType}`,
    conversationId,
    phoneNumberId,
    direction,
    sender,
    from: normalizePhone(from),
    to: to.map((item) => normalizePhone(item) ?? item),
    text: pickCallText(call, data, eventType),
    media: recordingUrl ? [{ type: "audio", url: recordingUrl }] : [],
    status: asString(call.status) ?? eventType,
    createdAt: asString(call.createdAt) ?? asString(call.created_at) ?? asString(data.createdAt) ?? new Date().toISOString(),
  };

  const normalizedConversation: NormalizedQuoConversation = {
    id: conversationId,
    customerName: asString(contact.name) ?? asString(conversation.name),
    customerNumber: normalizePhone(asString(firstPhone.value) ?? (direction === "inbound" ? from : to[0])),
    phoneNumberId,
    phoneNumberDisplay:
      asString(call.phoneNumber) ??
      asString(conversation.phoneNumber) ??
      (direction === "inbound" ? normalizedMessage.to[0] ?? null : normalizedMessage.from),
    phoneNumberName: asString(conversation.phoneNumberName) ?? asString(call.phoneNumberName),
  };

  return { message: normalizedMessage, conversation: normalizedConversation };
}

export function normalizeQuoPayload(payload: JsonObject, eventType = "message.received") {
  if (processableCallEvents.has(eventType)) {
    return normalizeQuoCallPayload(payload, eventType);
  }

  const data = (payload.data && typeof payload.data === "object" ? payload.data : payload) as JsonObject;
  const dataObject = (data.object && typeof data.object === "object" ? data.object : null) as JsonObject | null;
  const message = ((data.message && typeof data.message === "object"
    ? data.message
    : dataObject?.object === "message" || dataObject?.conversationId || dataObject?.conversation_id
      ? dataObject
      : data) ?? {}) as JsonObject;
  const conversation = ((data.conversation && typeof data.conversation === "object"
    ? data.conversation
    : payload.conversation && typeof payload.conversation === "object"
      ? payload.conversation
      : message.conversation && typeof message.conversation === "object"
        ? message.conversation
        : {}) ?? {}) as JsonObject;

  const messageId = asString(message.id);
  const conversationId =
    asString(conversation.id) ??
    asString(message.conversationId) ??
    asString(message.conversation_id);

  if (!messageId || !conversationId) {
    throw new Error("Invalid Quo payload: missing message id or conversation id.");
  }

  const rawDirection = asString(message.direction)?.toLowerCase();
  const direction = rawDirection === "outbound" || rawDirection === "outgoing" ? "outbound" : "inbound";
  const sender = direction === "inbound" ? "customer" : "agent";

  const contact = (conversation.contact && typeof conversation.contact === "object"
    ? conversation.contact
    : {}) as JsonObject;
  const phoneNumbers = Array.isArray(contact.phoneNumbers) ? contact.phoneNumbers : [];
  const firstPhone = phoneNumbers[0] && typeof phoneNumbers[0] === "object" ? phoneNumbers[0] as JsonObject : {};

  const to = arrayOfStrings(message.to);
  const from = asString(message.from);
  const customerNumber = normalizePhone(asString(firstPhone.value) ?? (direction === "inbound" ? from : to[0]));
  const phoneNumberId =
    asString(message.phoneNumberId) ??
    asString(message.phone_number_id) ??
    asString(conversation.phoneNumberId) ??
    null;

  const normalizedMessage: NormalizedQuoMessage = {
    id: messageId,
    conversationId,
    phoneNumberId,
    direction,
    sender,
    from: normalizePhone(from),
    to: to.map((item) => normalizePhone(item) ?? item),
    text: [
      asString(message.text) ?? asString(message.body) ?? "",
      extractTranscript(message.voicemailTranscript) || extractTranscript(message.transcript) ? `Transcript: \n${extractTranscript(message.voicemailTranscript) || extractTranscript(message.transcript)}` : "",
    ].filter(Boolean).join("\n\n"),
    media: Array.isArray(message.media) ? message.media : [],
    status: asString(message.status),
    createdAt: asString(message.createdAt) ?? asString(message.created_at) ?? new Date().toISOString(),
  };

  const normalizedConversation: NormalizedQuoConversation = {
    id: conversationId,
    customerName: asString(contact.name) ?? asString(conversation.name),
    customerNumber,
    phoneNumberId,
    phoneNumberDisplay:
      asString(message.phoneNumber) ??
      asString(conversation.phoneNumber) ??
      (direction === "inbound" ? normalizedMessage.to[0] ?? null : normalizedMessage.from),
    phoneNumberName: asString(conversation.phoneNumberName) ?? asString(message.phoneNumberName),
  };

  return { message: normalizedMessage, conversation: normalizedConversation };
}


function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value.trim());
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacBase64(key: Uint8Array, data: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode(...digest));
}

/**
 * OpenPhone/Quo delivery header: `hmac;1;<timestamp>;<base64 digest>`, where the
 * digest is HMAC-SHA256 over `<timestamp>.<raw body>` keyed with the
 * base64-decoded signing secret. Older/forwarded deliveries are tried with the
 * raw secret too. Each path still requires a valid HMAC from our secret.
 */
async function verifyOpenPhoneHmacHeader(rawBody: string, header: string, secret: string) {
  const parts = header.split(";");
  if (parts.length !== 4 || parts[0] !== "hmac" || parts[1] !== "1") return false;
  const [, , timestamp, provided] = parts;
  if (!/^\d+$/.test(timestamp) || !provided) return false;
  const signed = `${timestamp}.${rawBody}`;
  const keys = [decodeBase64(secret), new TextEncoder().encode(secret)].filter((key): key is Uint8Array => Boolean(key?.length));
  for (const key of keys) {
    if (constantTimeEqual(await hmacBase64(key, signed), provided.trim())) return true;
  }
  return false;
}

export async function verifySignature(rawBody: string, signature: string | null, secret: string | undefined) {
  if (!secret || !signature) return false;

  let signHash = signature.trim();

  if (signHash.startsWith("hmac;")) {
    try {
      return await verifyOpenPhoneHmacHeader(rawBody, signHash, secret);
    } catch {
      return false;
    }
  }

  // Handle OpenPhone format: t=1643052145,v1=9131de4fc...
  if (signHash.includes("v1=")) {
    const parts = signHash.split(",");
    const v1Part = parts.find((p) => p.startsWith("v1="));
    if (v1Part) {
      signHash = v1Part.replace("v1=", "");
    }
  }

  const normalized = signHash.replace(/^sha256=/, "").trim().toLowerCase();

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const expected = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    return constantTimeEqual(expected, normalized);
  } catch {
    return false;
  }
}

