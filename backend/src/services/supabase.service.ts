// Adaptador de compatibilidad. Los consumidores de negocio conservan este import,
// pero la selección cloud/local/hybrid vive en un único servicio de infraestructura.
export { uploadFile, downloadFile, deleteFile, getSignedUrl, checkStorageHealth, getStorageInfo } from '../storage/storage.service';
export { getSupabaseClient, BUCKET_NAME } from '../storage/cloudStorage.provider';
