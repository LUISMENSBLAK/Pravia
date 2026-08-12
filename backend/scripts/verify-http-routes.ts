import http from 'http';

function checkUrl(urlStr: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get(urlStr, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function run() {
  console.log('Testing backend server endpoints on port 3001...');
  try {
    const health = await checkUrl('http://localhost:3001/api/health');
    console.log(`GET /api/health -> Status: ${health.status}`);
  } catch (err: any) {
    console.error('Error connecting to backend health:', err.message);
  }
}

run();
