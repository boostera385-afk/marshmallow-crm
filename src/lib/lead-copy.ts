import type { Lead } from "@/types";
import { toast } from "sonner";

export const copyTextToClipboard = async (text: string, htmlText?: string) => {
  if (navigator?.clipboard?.write) {
    const data: Record<string, Blob> = {
      "text/plain": new Blob([text], { type: "text/plain" }),
    };
    if (htmlText) {
      data["text/html"] = new Blob([htmlText], { type: "text/html" });
    }
    try {
      const item = new ClipboardItem(data);
      await navigator.clipboard.write([item]);
      return;
    } catch (err) {
      console.error("Clipboard write failed, trying fallback:", err);
    }
  }

  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      console.error("Clipboard text write failed, trying fallback:", err);
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  const previousFocus = document.activeElement;
  try {
    textArea.focus();
    textArea.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard copy failed");
  } finally {
    textArea.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }
};

const formatTime = (time?: string | null) => {
  if (!time) return "";
  const [hourRaw, minuteRaw = "00"] = time.split(":");
  const hourNum = Number(hourRaw);
  if (Number.isNaN(hourNum)) return time;
  const ampm = hourNum >= 12 ? "PM" : "AM";
  const hour = hourNum % 12 || 12;
  return `${hour}:${minuteRaw.padStart(2, "0")} ${ampm}`;
};

export const formatLeadSchedule = (lead: Pick<Lead, "scheduled_date" | "scheduled_time_start" | "scheduled_time_end">) => {
  if (!lead.scheduled_date) return "Not scheduled";

  const date = new Date(`${lead.scheduled_date}T12:00:00`);
  const dateText = Number.isNaN(date.getTime()) ? lead.scheduled_date : date.toLocaleDateString();
  const start = formatTime(lead.scheduled_time_start);
  const end = formatTime(lead.scheduled_time_end);

  if (start && end) return `${dateText}, ${start} - ${end}`;
  if (start) return `${dateText}, ${start}`;
  return dateText;
};

export interface LeadCopyDetails {
  service_details?: string | null;
  address?: string | null;
  customer_schedule_requirements?: string | null;
  quote?: string | null;
  show_quote_to_opr?: boolean | null;
}
export const buildCompleteLeadCopyText = (lead: LeadCopyDetails, includeQuote = true) => {
  const lines = [
    ["Service Details", lead.service_details],
    ["Address", lead.address],
    ["Schedule Requirement", lead.customer_schedule_requirements],
    ["Quote", includeQuote ? lead.quote : ""],
  ];

  return lines
    .map(([label, value]) => `${label}: ${value?.trim() || ""}`)
    .join("\n");
};

const convertToPngBlob = (url: string): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas context is null"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas conversion to Blob failed"));
      }, "image/png");
    };
    img.onerror = (e) => reject(e);
    img.src = url;
  });
};

export const copyImageToClipboard = async (url: string) => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    
    let pngBlob = blob;
    if (blob.type !== "image/png") {
      pngBlob = await convertToPngBlob(url);
    }

    if (navigator?.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": pngBlob,
        }),
      ]);
      toast.success("Image copied to clipboard");
    } else {
      toast.error("Clipboard API not supported in this browser");
    }
  } catch (err) {
    console.error("Failed to copy image:", err);
    toast.error("Failed to copy image due to browser or network restrictions");
  }
};

/** Chrome supports only one clipboard item. Copy a numbered contact sheet,
 * rather than silently dropping photos or requesting unsupported multi-item writes.
 * A promise lets callers start signing URLs without losing clipboard activation.
 */
export const copyImagesToClipboard = async (urls: string[] | Promise<string[]>) => {
  try {
    if (!navigator?.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("Clipboard API not supported in this browser");
    }

    const image = Promise.resolve(urls).then(buildPhotoSheet);
    // Register the write immediately during the click, before downloads finish.
    // Also observe image failures if the browser rejects the write early.
    void image.catch(() => undefined);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
    toast.success(`${(await urls).length} photos copied as one image — paste into your chat`);
  } catch (err) {
    console.error("Failed to copy photos:", err);
    toast.error("Failed to copy photos due to browser or network restrictions");
  }
};

export async function buildPhotoSheet(urls: string[]): Promise<Blob> {
  if (!urls.length) throw new Error("No photos to copy");
  const objectUrls: string[] = [];
  try {
    const images = [];
    // Sequential decoding keeps large lead albums from downloading simultaneously.
    for (const url of urls) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to download image (${response.status})`);
      const source = URL.createObjectURL(await response.blob());
      objectUrls.push(source);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not decode a lead photo"));
        image.src = source;
      });
      images.push(img);
    }
    const columns = Math.ceil(Math.sqrt(images.length));
    const rows = Math.ceil(images.length / columns);
    const cell = Math.min(1200, Math.floor(4096 / Math.max(columns, rows)));
    const canvas = document.createElement("canvas");
    canvas.width = columns * cell;
    canvas.height = rows * cell;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context is null");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    images.forEach((img, index) => {
      const x = (index % columns) * cell;
      const y = Math.floor(index / columns) * cell;
      const labelHeight = Math.max(24, Math.floor(cell * 0.035));
      const scale = Math.min((cell - 16) / img.naturalWidth, (cell - labelHeight - 16) / img.naturalHeight);
      const width = img.naturalWidth * scale;
      const height = img.naturalHeight * scale;
      ctx.drawImage(img, x + (cell - width) / 2, y + labelHeight + (cell - labelHeight - height) / 2, width, height);
      ctx.fillStyle = "#111827";
      ctx.font = `${Math.max(14, labelHeight - 6)}px sans-serif`;
      ctx.fillText(`Photo ${index + 1}`, x + 8, y + labelHeight - 4);
    });
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create photo sheet")), "image/png");
    });
  } finally {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
}

