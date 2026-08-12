import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(url, key);

async function resetBucket() {
  console.log('Deleting old bucket...');
  
  // First empty it
  const { data: files } = await supabase.storage.from('pravia_documentos').list();
  if (files && files.length > 0) {
    const paths = files.map(f => f.name);
    await supabase.storage.from('pravia_documentos').remove(paths);
    console.log(`Removed ${paths.length} files.`);
  }

  const { error: deleteError } = await supabase.storage.deleteBucket('pravia_documentos');
  if (deleteError) {
    console.error('Delete error:', deleteError.message);
  } else {
    console.log('Old bucket deleted.');
  }

  // Wait a moment
  await new Promise(r => setTimeout(r, 2000));

  console.log('Creating fresh bucket without MIME restrictions...');
  const { data, error } = await supabase.storage.createBucket('pravia_documentos', {
    public: false,
    fileSizeLimit: 20971520 // 20MB, no MIME restrictions
  });

  if (error) {
    console.error('Create error:', error.message);
  } else {
    console.log('Fresh bucket created:', data);
  }
}

resetBucket();
