import { FileText, Paperclip, X } from 'lucide-react';
import styles from '../ProspectsPage.module.css';

const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function ProspectDocumentPicker({
  id,
  label,
  files,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  files: File[];
  disabled?: boolean;
  onChange: (files: File[]) => void;
}) {
  return <div className={styles.documentPicker}>
    <input id={id} className={styles.fileInput} type="file" multiple disabled={disabled} onChange={(event) => {
      onChange([...files, ...Array.from(event.target.files ?? [])]);
      event.currentTarget.value = '';
    }} />
    <label htmlFor={id} aria-disabled={disabled}><Paperclip size={16} />{label}</label>
    {files.length > 0 && <ul>{files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}><FileText size={15} /><span><strong>{file.name}</strong><small>{size(file.size)}</small></span><button type="button" aria-label={`Quitar ${file.name}`} onClick={() => onChange(files.filter((_, itemIndex) => itemIndex !== index))}><X size={15} /></button></li>)}</ul>}
  </div>;
}
