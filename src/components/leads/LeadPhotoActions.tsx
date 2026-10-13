import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { canSeeTechDetails } from "@/lib/access";
import { copyImagesToClipboard } from "@/lib/lead-copy";
import { getSignedUrls } from "@/lib/storage";
import { prepareTechPhotos, resolveTechPhotoChat } from "@/lib/quo-tech-photos";
import ImageLightbox from "./ImageLightbox";

export default function LeadPhotoActions({ paths, techNumber }: { paths: string[]; techNumber?: string | null }) {
  const { role, canAccess } = useAuth();
  const [action, setAction] = useState<"copy" | "tech" | "view" | null>(null);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const previewRequest = useRef(0);
  const viewButton = useRef<HTMLButtonElement>(null);
  const pathsKey = JSON.stringify(paths);
  useEffect(() => {
    setPreviewImages([]);
    setAction((current) => current === "view" ? null : current);
    return () => { previewRequest.current += 1; };
  }, [pathsKey]);
  const canSendToTech = canAccess("tech_quick_chat") && canSeeTechDetails(role) && !!techNumber;
  if (!paths.length) return null;

  const viewAll = async () => {
    if (action) return;
    const request = ++previewRequest.current;
    setAction("view");
    try {
      const urls = await getSignedUrls(paths);
      if (request !== previewRequest.current) return;
      if (urls.length !== paths.length || urls.some((url) => !url)) {
        throw new Error("Could not load all photo previews. Please retry.");
      }
      setPreviewImages(urls);
    } catch (error) {
      if (request === previewRequest.current) {
        toast.error(error instanceof Error ? error.message : "Could not load photo previews");
      }
    } finally {
      if (request === previewRequest.current) setAction(null);
    }
  };

  const copyAll = async () => {
    if (action) return;
    setAction("copy");
    try {
      // Register the clipboard write in the original click, before URL signing.
      await copyImagesToClipboard(getSignedUrls(paths));
    } finally {
      setAction(null);
    }
  };

  const sendToTech = async () => {
    if (action || !canSendToTech || !techNumber) return;
    setAction("tech");
    try {
      const chatUrl = await resolveTechPhotoChat(techNumber);
      await prepareTechPhotos(chatUrl, await getSignedUrls(paths));
      toast.success("Photos handed to Quo. Review all attachments in the technician chat, then click Send.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare technician photos");
    } finally {
      setAction(null);
    }
  };

  return <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
    <Button ref={viewButton} type="button" variant="outline" size="sm"
      className="h-8 gap-1.5 rounded-lg px-2.5 text-[11px] font-medium"
      disabled={action !== null}
      title="View all saved photos without copying or sending them"
      onClick={(event) => { event.preventDefault(); void viewAll(); }}>
      <Eye className="h-2.5 w-2.5" />
      {action === "view" ? "Loading photos..." : `View ${paths.length} ${paths.length === 1 ? "photo" : "photos"}`}
    </Button>
    <Button type="button" variant="outline" size="sm"
      className="h-8 gap-1.5 rounded-lg px-2.5 text-[11px] font-medium"
      disabled={action !== null}
      title="Copy all photos as one combined image to paste into a chat"
      onClick={(event) => { event.preventDefault(); void copyAll(); }}>
      <Copy className="h-2.5 w-2.5" />
      {action === "copy" ? "Copying..." : `Copy all ${paths.length} photos`}
    </Button>
    {canSendToTech && <Button type="button" variant="outline" size="sm"
      className="h-8 gap-1.5 rounded-lg px-2.5 text-[11px] font-medium"
      disabled={action !== null}
      title="Attach all original photos in the assigned technician's Quo chat for review and sending"
      onClick={(event) => { event.preventDefault(); void sendToTech(); }}>
      <ExternalLink className="h-2.5 w-2.5" />
      {action === "tech" ? "Preparing..." : "Send photos to tech"}
    </Button>}
    <ImageLightbox images={previewImages} open={previewImages.length > 0} returnFocusRef={viewButton}
      onOpenChange={(open) => { if (!open) setPreviewImages([]); }} />
  </div>;
}
