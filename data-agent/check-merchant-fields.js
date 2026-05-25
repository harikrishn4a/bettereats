import puppeteer from 'puppeteer-core';
import dotenv from 'dotenv';
dotenv.config();

let cookies = [];

async function connectToExistingBrowser() {
  const response = await fetch('http://127.0.0.1:9222/json/version');
  const data = await response.json();
  const browser = await puppeteer.connect({ browserWSEndpoint: data.webSocketDebuggerUrl });
  return browser;
}

async function refreshCookies() {
  const browser = await connectToExistingBrowser();
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('grab.com')) || pages[0];
  cookies = await page.cookies();
  await browser.disconnect();
}

(async () => {
  await refreshCookies();
  
  const payload = { latlng: '1.37016,103.84963', keyword: '', offset: 0, pageSize: 1, countryCode: 'SG' };
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  const response = await fetch('https://portal.grab.com/foodweb/guest/v2/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Country-Code': 'SG',
      'X-Gfc-Country': 'SG',
      'X-Grab-Web-App-Version': '26yyTbu4FdOlUheJ4la26',
      'Cookie': cookieHeader
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  const merchant = data.searchResult.searchMerchants[0];
  
  console.log('ALL FIELDS IN MERCHANT OBJECT:');
  console.log(JSON.stringify(merchant, null, 2));
  
  console.log('\n\nKEY FIELDS:');
  console.log('id:', merchant.id);
  console.log('address.name:', merchant.address?.name);
  console.log('Has slug?:', merchant.merchantBrief?.slug);
  console.log('Has deliveryUrl?:', merchant.deliveryUrl);
  console.log('Has merchantUrl?:', merchant.merchantUrl);
  console.log('All top-level keys:', Object.keys(merchant));
})();
