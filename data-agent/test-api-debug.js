import puppeteer from 'puppeteer-core';
import { createClient } from '@supabase/supabase-js';
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

async function testAPICall(name, lat, lng, offset = 0) {
  const payload = { latlng: `${lat},${lng}`, keyword: '', offset, pageSize: 32, countryCode: 'SG' };
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  try {
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
    
    console.log(`\n${name}`);
    console.log(`  Status: ${response.status}`);
    console.log(`  Total: ${data.searchResult?.totalCount}`);
    console.log(`  Page: ${data.searchResult?.searchMerchants?.length}`);
  } catch (error) {
    console.log(`\n${name} - ERROR: ${error.message}`);
  }
}

(async () => {
  await refreshCookies();
  await testAPICall('Ang Mo Kio', 1.37016, 103.84963, 0);
  await testAPICall('Bukit Batok', 1.34475, 103.74804, 0);
  await testAPICall('Clementi', 1.31511, 103.76218, 0);
  await testAPICall('Jurong East', 1.34081, 103.74475, 0);
})();
