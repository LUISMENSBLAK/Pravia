import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(url, key);

async function initBucket() {
  console.log('Creando bucket de PRAVIA OS...');
  const { data, error } = await supabase.storage.createBucket('pravia_documentos', {
    public: false,
    fileSizeLimit: 10485760 // 10MB
  });

  if (error) {
    if (error.message.includes('already exists')) {
      console.log('El bucket "pravia_documentos" ya existe.');
    } else {
      console.error('Error al crear el bucket:', error.message);
    }
  } else {
    console.log('Bucket "pravia_documentos" creado exitosamente:', data);
  }
}

initBucket();
