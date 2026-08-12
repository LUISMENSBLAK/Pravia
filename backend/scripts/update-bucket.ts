import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(url, key);

async function updateBucket() {
  console.log('Updating bucket "pravia_documentos" to allow all file types...');
  const { data, error } = await supabase.storage.updateBucket('pravia_documentos', {
    public: false,
    fileSizeLimit: 20971520 // 20MB
  });

  if (error) {
    console.error('Error updating bucket:', error.message);
  } else {
    console.log('Bucket updated successfully:', data);
  }
}

updateBucket();
