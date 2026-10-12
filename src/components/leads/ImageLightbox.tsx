import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";

export interface LightboxImage {
  src: string;
  fallback?: string;
}

interface ImageLightboxProps {
  images: Array<string | LightboxImage>;
  initialIndex?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement>;
}

function normalize(item: string | LightboxImage): LightboxImage {
  return typeof item === "string" ? { src: item } : item;
}

export default function ImageLightbox({ images, initialIndex = 0, open, onOpenChange, returnFocusRef }: ImageLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [usedFallback, setUsedFallback] = useState(false);
  const [imgErrored, setImgErrored] = useState(false);

  useEffect(() => {
    if (open) setCurrentIndex(initialIndex);
  }, [initialIndex, open]);

  const current = images[currentIndex] ? normalize(images[currentIndex]) : undefined;
  const currentSrc = current?.src;
  const currentFallback = current?.fallback;
  const displaySrc = usedFallback && currentFallback ? currentFallback : currentSrc;

  // Reset state when the source for the current slide changes.
  useEffect(() => {
    setImgLoaded(false);
    setUsedFallback(false);
    setImgErrored(false);
  }, [currentSrc]);

  const handlePrev = () => setCurrentIndex((i) => (i > 0 ? i - 1 : images.length - 1));
  const handleNext = () => setCurrentIndex((i) => (i < images.length - 1 ? i + 1 : 0));

  if (!images.length) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        onCloseAutoFocus={(event) => {
          if (returnFocusRef?.current?.isConnected) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
        overlayClassName="z-[100]"
        className="z-[100] max-w-[90vw] max-h-[90vh] p-0 bg-black/95 border-none overflow-hidden"
      >
        <DialogTitle className="sr-only">Photo preview</DialogTitle>
        <DialogDescription className="sr-only">View the saved images. Use the previous and next buttons to browse photos.</DialogDescription>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close image"
          className="absolute top-3 right-3 z-50 text-white/70 hover:text-white hover:bg-white/10 [&_svg]:size-5"
          onClick={() => onOpenChange(false)}
        >
          <X />
        </Button>

        <div className="flex items-center justify-center min-h-[60vh] relative">
          {images.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous image"
              className="absolute left-2 z-40 text-white/70 hover:text-white hover:bg-white/10"
              onClick={handlePrev}
            >
              <ChevronLeft className="h-6 w-6" />
            </Button>
          )}

          {!imgLoaded && !imgErrored && displaySrc && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70">
              <div className="w-8 h-8 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              <p className="text-xs">Loading image…</p>
            </div>
          )}

          {displaySrc && !imgErrored && (
            <img
              key={displaySrc}
              src={displaySrc}
              alt={`Image ${currentIndex + 1}`}
              className="max-w-full max-h-[85vh] object-contain"
              style={{ opacity: imgLoaded ? 1 : 0, transition: "opacity 200ms ease" }}
              onLoad={() => setImgLoaded(true)}
              onError={() => {
                console.error("[Lightbox] Image failed to load");
                if (!usedFallback && currentFallback && currentFallback !== currentSrc) {
                  // Try fallback (usually a smaller cached preview)
                  setUsedFallback(true);
                  setImgLoaded(false);
                } else {
                  setImgErrored(true);
                }
              }}
            />
          )}

          {imgErrored && (
            <div className="text-white/60 text-sm px-6 text-center">
              Couldn't load this image. Try closing and reopening.
            </div>
          )}

          {images.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next image"
              className="absolute right-2 z-40 text-white/70 hover:text-white hover:bg-white/10"
              onClick={handleNext}
            >
              <ChevronRight className="h-6 w-6" />
            </Button>
          )}
        </div>

        {images.length > 1 && (
          <div className="text-center text-white/50 text-xs pb-3">
            {currentIndex + 1} / {images.length}
            {usedFallback && <span className="ml-2 opacity-70">(preview quality)</span>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
