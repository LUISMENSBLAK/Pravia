export async function downloadPrivateUrl(url: string, name: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('DOCUMENT_DOWNLOAD_FAILED');
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
