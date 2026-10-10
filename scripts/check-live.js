const https = require('https');

function checkUrl(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location;
        if (!loc.startsWith('http')) loc = 'https://budgetthrills.shop' + loc;
        return resolve(checkUrl(loc));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const navMatch = data.match(/<nav class="hidden md:flex[^>]*>([\s\S]*?)<\/nav>/);
        const h1Match = data.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
        resolve({
          url,
          status: res.statusCode,
          nav: navMatch ? navMatch[1].replace(/\s+/g, ' ').trim() : 'NOT FOUND',
          h1: h1Match ? h1Match[1].replace(/\s+/g, ' ').trim() : 'NOT FOUND'
        });
      });
    }).on('error', (e) => resolve({ url, error: e.message }));
  });
}

async function main() {
  const urls = [
    'https://budgetthrills.shop/collection.html',
    'https://budgetthrills.shop/tech.html',
    'https://budgetthrills.shop/accessories.html',
    'https://budgetthrills.shop/gaming.html'
  ];
  for (const u of urls) {
    const res = await checkUrl(u);
    console.log(res);
  }
}

main();
