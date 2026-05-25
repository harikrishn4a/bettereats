#!/usr/bin/env node

import puppeteer from 'puppeteer-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

let supabase;
let cookies = [];

const ALL_DISTRICTS = [
  { name: 'Ang Mo Kio', lat: 1.37016, lng: 103.84963 },
  { name: 'Bedok', lat: 1.32485, lng: 103.93379 },
  { name: 'Bishan', lat: 1.35132, lng: 103.84873 },
  { name: 'Bukit Batok', lat: 1.34475, lng: 103.74804 },
  { name: 'Bukit Merah', lat: 1.27969, lng: 103.81565 },
  { name: 'Bukit Timah', lat: 1.34162, lng: 103.75915 },
  { name: 'Choa Chu Kang', lat: 1.38447, lng: 103.74393 },
  { name: 'Clementi', lat: 1.31511, lng: 103.76218 },
  { name: 'Geylang', lat: 1.30726, lng: 103.86398 },
  { name: 'Hougang', lat: 1.36731, lng: 103.89308 },
  { name: 'Jurong East', lat: 1.34081, lng: 103.74475 },
  { name: 'Jurong West', lat: 1.34053, lng: 103.70476 },
  { name: 'Kallang', lat: 1.30627, lng: 103.87353 },
  { name: 'Katong', lat: 1.29815, lng: 103.89849 },
  { name: 'Macpherson', lat: 1.32638, lng: 103.87036 },
  { name: 'Marine Parade', lat: 1.3017, lng: 103.89606 },
  { name: 'Novena', lat: 1.32034, lng: 103.84308 },
  { name: 'Orchard', lat: 1.30449, lng: 103.83441 },
  { name: 'Potong Pasir', lat: 1.32961, lng: 103.86201 },
  { name: 'Punggol', lat: 1.40451, lng: 103.90434 },
  { name: 'Queenstown', lat: 1.29589, lng: 103.80194 },
  { name: 'Serangoon', lat: 1.35069, lng: 103.87195 },
  { name: 'Sengkang', lat: 1.39485, lng: 103.8949 },
  { name: 'Senoko', lat: 1.43989, lng: 103.80566 },
  { name: 'Sentosa', lat: 1.24955, lng: 103.82065 },
  { name: 'Sembawang', lat: 1.42383, lng: 103.82209 },
  { name: 'Tampines', lat: 1.35272, lng: 103.94502 },
  { name: 'Tanjong Pagar', lat: 1.27668, lng: 103.84485 },
];

const BATCH_SIZE = 4;

async function initSupabase() {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

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

async function callGrabAPIWithRetry(lat, lng, offset = 0, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const payload = { latlng: `${lat},${lng}`, keyword: '', offset, pageSize: 32, countryCode: 'SG' };
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const response = await fetch('https://portal.grab.com/foodweb/guest/v2/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Country-Code': 'SG',
        'X-Gfc-Country': 'SG',
        'X-Grab-Web-App-Version': '26yyTbu4FdOlUheJ4la26',
        'Cookie': cookieHeader,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 429) {
      const waitTime = Math.pow(2, attempt) * 5000;
      console.log(`    ⚠️  Rate limited (429)! Attempt ${attempt}/${retries}. Waiting ${waitTime / 1000}s...`);
      await new Promise(r => setTimeout(r, waitTime));
      continue;
    }

    if (!response.ok) return [];

    const data = await response.json();
    const merchants = data.searchResult?.searchMerchants || [];

    return merchants.map(m => ({
      name: m.address?.name || '',
      cuisine: (m.merchantBrief?.cuisine || []).join(', '),
      rating: m.merchantBrief?.rating || 0,
      url: `https://food.grab.com/sg/en/restaurant/${m.id}` || '',
      lat: m.latlng?.latitude || 0,
      lng: m.latlng?.longitude || 0,
    })).filter(r => r.name.length > 0);
  }

  console.log(`    ❌ Failed after ${retries} retries`);
  return [];
}

async function scrapeDistrict(district, index, total) {
  console.log(`[${index}/${total}] ${district.name}`);

  let allRestaurants = [];
  let offset = 0;
  let pageNum = 1;

  while (true) {
    const restaurants = await callGrabAPIWithRetry(district.lat, district.lng, offset, 3);
    if (restaurants.length === 0) {
      console.log('  ⏹️  No more pages');
      break;
    }

    console.log(`  📄 Page ${pageNum}: ${restaurants.length} restaurants`);
    allRestaurants = allRestaurants.concat(restaurants);

    offset += 32;
    pageNum++;

    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`  ✅ Total: ${allRestaurants.length}\n`);

  if (allRestaurants.length > 0) {
    const uniqueRestaurants = [];
    const seen = new Set();

    allRestaurants.forEach(r => {
      const key = `${r.name}|${district.name}`;
      if (!seen.has(key)) {
        uniqueRestaurants.push({
          name: r.name,
          cuisine: r.cuisine,
          rating: r.rating,
          grab_url: r.url,
          district: district.name,
          delivery_time: '',
          health_score: 0,
          latitude: r.lat,
          longitude: r.lng,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        seen.add(key);
      }
    });

    if (uniqueRestaurants.length > 0) {
      const { error } = await supabase.from('restaurants').insert(uniqueRestaurants);
      if (!error) {
        console.log(`  💾 Saved: ${uniqueRestaurants.length}`);
      }
    }
  }
}

(async () => {
  const startIndex = parseInt(process.argv[2], 10) || 0;
  const endIndex = Math.min(startIndex + BATCH_SIZE, ALL_DISTRICTS.length);

  console.log(`🚀 Batch ${Math.floor(startIndex / BATCH_SIZE) + 1}: Districts ${startIndex + 1}-${endIndex}\n`);

  await initSupabase();
  await refreshCookies();

  for (let i = startIndex; i < endIndex; i++) {
    if (i > startIndex) {
      console.log('⏳ Waiting 15 seconds before next district...');
      await new Promise(r => setTimeout(r, 15000));
      await refreshCookies();
    }
    await scrapeDistrict(ALL_DISTRICTS[i], i + 1, ALL_DISTRICTS.length);
  }

  console.log('✅ Batch complete!');
  if (endIndex < ALL_DISTRICTS.length) {
    console.log(`\n📝 Next: node extract-batch-with-retry.js ${endIndex}`);
  }
})();
