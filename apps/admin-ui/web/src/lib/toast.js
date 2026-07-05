import { toast } from 'sonner';

export { toast };

export function toastError(err, fallback = 'Something went wrong') {
  const msg = (err && (err.message || err.toString())) || fallback;
  toast.error(msg);
  return msg;
}

export function toastSuccess(message) {
  toast.success(message);
}

export async function copyToClipboard(text, { successMessage = 'Copied to clipboard' } = {}) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
    return true;
  } catch {
    toast.error('Copy failed — select and copy manually');
    return false;
  }
}
