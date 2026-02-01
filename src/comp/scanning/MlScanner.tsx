import Camera from 'react-html5-camera-photo';
import 'react-html5-camera-photo/build/css/index.css';

// Note: Jimp is not available in the browser environment by default
// You'll need to use a browser-compatible image processing library
// or handle resizing on the server side

const MlScanner = () => {
  const dataURItoBlob = (dataURI: string): Blob => {
    const [header, base64] = dataURI.split(',');
    const mime = header.match(/:(.*?);/)?.[1];
    if (!mime) throw new Error("Invalid data URI");
    const bin = atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };

  async function sendBlobImage(blobImage: Blob) {
    try {
      const formData = new FormData();
      formData.append('image', blobImage, 'inference.jpg');
      console.log("form data out of the ml scanner: " + formData)
      const res = await fetch('/api/send_inference_image', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        console.error('Upload failed:', res.statusText);
        return;
      }
      const result = await res.json();
      console.log('Got class:', result);
      return result;
    } catch (error) {
      console.error('Error sending image:', error);
    }
  }

  // Browser-compatible image resizing using Canvas API
  const resizeImageWithCanvas = (
    dataUri: string,
    targetWidth: number,
    targetHeight: number
  ): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        
        // Draw and resize the image
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        
        // Convert back to data URI
        const resizedDataUri = canvas.toDataURL('image/jpeg', 0.8);
        resolve(resizedDataUri);
      };
      img.src = dataUri;
    });
  };

  const doInference = async (dataUri: string) => {
    try {
      // Resize the image first
      const resizedDataUri = await resizeImageWithCanvas(dataUri, 224, 224);
      
      // Convert to blob
      const blob = dataURItoBlob(resizedDataUri);
      
      // Send for inference
      await sendBlobImage(blob);
    } catch (error) {
      console.error('Error during inference:', error);
    }
  };

  return (
    <div>
      <Camera 
        onTakePhoto={(dataUri) => doInference(dataUri)}
        idealFacingMode="environment" // Use back camera for scanning
        isMaxResolution={false}
        isImageMirror={false}
      />
    </div>
  );
};

export default MlScanner;