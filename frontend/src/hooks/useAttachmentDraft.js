import { useEffect, useRef, useState } from 'react';
import { removeAttachment, uploadAttachment } from '../api/attachments';
import { useToasts } from './useToasts';
import { copy } from '../copy';

const t = copy.debate;

export const MAX_FILES = 3;
export const FILE_TYPES = '.pdf,.docx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp';

/**
 * Файли, що чекають на надсилання разом із питанням чи уточненням.
 * Сервер одразу читає з них текст; поки читає, файл має status 'reading'.
 * Мініатюру й перегляд показуємо з самого файлу — сервер тримає лише текст.
 */
export function useAttachmentDraft() {
  const [files, setFiles] = useState([]);
  const { pushToast } = useToasts();
  const reading = files.some((item) => item.status === 'reading');

  const addFiles = (list) => {
    const room = MAX_FILES - files.length;
    const picked = [...(list || [])].slice(0, Math.max(0, room));
    if ((list?.length || 0) > room) pushToast(t.attachMax);
    picked.forEach(async (file) => {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      const isImage = file.type.startsWith('image/');
      const url = (isImage || file.type === 'application/pdf') && URL.createObjectURL
        ? URL.createObjectURL(file)
        : '';
      setFiles((current) => [
        ...current,
        { key, name: file.name, status: 'reading', kind: isImage ? 'image' : '', url, source: file },
      ]);
      try {
        const data = await uploadAttachment(file);
        setFiles((current) =>
          current.map((item) => (item.key === key ? { ...item, ...data, status: 'ready' } : item))
        );
      } catch (err) {
        setFiles((current) => current.filter((item) => item.key !== key));
        if (url) URL.revokeObjectURL(url);
        pushToast(err?.message || t.attachError);
      }
    });
  };

  const removeFile = (file) => {
    setFiles((current) => current.filter((item) => item.key !== file.key));
    if (file.url) URL.revokeObjectURL(file.url);
    if (file.id) removeAttachment(file.id).catch(() => {});
  };

  // файли надіслано — на сервері вони вже прив'язані, тож лише звільняємо локальні адреси
  const clearFiles = () => {
    setFiles((current) => {
      current.forEach((item) => item.url && URL.revokeObjectURL(item.url));
      return [];
    });
  };

  // локальні адреси файлів звільняємо, коли сторінку закрито
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(
    () => () => filesRef.current.forEach((item) => item.url && URL.revokeObjectURL(item.url)),
    []
  );

  const ids = files.filter((item) => item.id).map((item) => item.id);

  return { files, ids, reading, addFiles, removeFile, clearFiles };
}
