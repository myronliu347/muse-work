import React from "react";
import type { AttachedImagesProps } from "../types";
import "../styles/AttachedImages.css";

/**
 * Thumbnail strip for pasted/attached images above the sender.
 * Hover reveals a delete control on each thumb.
 */
export const AttachedImages: React.FC<AttachedImagesProps> = ({
  images,
  onRemove,
}) => {
  if (images.length === 0) {
    return null;
  }

  return (
    <div className="attached-images" data-testid="attached-images">
      {images.map((image) => (
        <div
          key={image.id}
          className="image-item"
          title={image.filename || "Image"}
        >
          <img
            className="image-thumb"
            src={image.data}
            alt={image.filename || "attached"}
            draggable={false}
          />
          <button
            className="remove-image-btn"
            onClick={() => onRemove(image.id)}
            title="删除"
            type="button"
            aria-label="删除图片"
            data-testid={`remove-image-${image.id}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};
