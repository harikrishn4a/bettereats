import puppeteer from 'puppeteer-core';
import dotenv from 'dotenv';
dotenv.config();

let cookies = [];

async function connectToExistingBrowser() {
  const response = await fetch('http://127.0.0.1:9222/json/version');
  const data = await response.json();
  const wsEndpoint = data.webSocketDebuggerUrl;
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
  return browser;
}

async function refreshCookies() {
  const browser = await connectToExistingBrowser();
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('grab.com')) || pages[0];
  cookies = await page.cookies();
  await browser.disconnect();
}

async function testBishan() {
  await refreshCookies();
  
  const lat = 1.35132;
  const lng = 103.84873;
  
  console.log(`Testing Bishan (${lat}, ${lng})`);
  console.log(`Cookies: ${cookies.length}`);
  
  const payload = { latlng: `${lat},${lng}`, keyword: '', offset: 0, pageSize: 32, countryCode: 'SG' };
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

  console.log(`Status: ${response.status}`);
  const data = await response.json();
  console.log(`Total count: ${data.searchResult?.totalCount}`);
  console.log(`Merchants: ${data.searchResult?.searchMerchants?.length}`);
  console.log(`First merchant: ${data.searchResult?.searchMerchants?.[0]?.address?.name || 'NONE'}`);
}

testBishan();
