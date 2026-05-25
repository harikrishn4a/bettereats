#!/usr/bin/env node

import puppeteer from 'puppeteer-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROGRESS_FILE = path.join(__dirname, '.scrape-progress.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const PAGE_SIZE = 32;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '4', 10);
const PAGE_DELAY_MS = 4000;
const MAX_RETRIES = 5;

const DISTRICTS = [
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

let supabase;
let cookies = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function readProgress() {
  if (!existsSync(PROGRESS_FILE)) {
    return { nextDistrictIndex: 0 };
  }
  const raw = await readFile(PROGRESS_FILE, 'utf8');
  return JSON.parse(raw);
}

async function writeProgress(nextDistrictIndex) {
  await writeFile(
    PROGRESS_FILE,
    JSON.stringify({ nextDistrictIndex, updatedAt: new Date().toISOString() }, null, 2)
  );
}

async function initSupabase() {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('✅ Supabase connected\n');
}

async function connectToExistingBrowser() {
  const response = await fetch('http://127.0.0.1:9222/json/version');
  const data = await response.json();

  return puppeteer.connect({
    browserWSEndpoint: data.webSocketDebuggerUrl,
  });
}

async function refreshCookies(quiet = false) {
  try {
    const browser = await connectToExistingBrowser();
    const pages = await browser.pages();
    const page = pages.find(p => p.url().includes('grab.com')) || pages[0];

    if (!page) {
      throw new Error('No Chrome tabs found. Open https://food.grab.com in debug Chrome first.');
    }

    cookies = await page.cookies();

    if (!quiet) {
      console.log(`🔄 Refreshed cookies (${cookies.length} total)\n`);
    } else {
      console.log(`    🔄 Refreshed cookies (${cookies.length} total)`);
    }

    await browser.disconnect();
    return true;
  } catch (error) {
    console.error('❌ Cookie refresh failed:', error.message);
    return false;
  }
}

function parseRestaurants(data) {
  const searchMerchants = data.searchResult?.searchMerchants || [];

  return searchMerchants.map(m => ({
    name: m.address?.name || '',
    cuisine: (m.merchantBrief?.cuisine || []).join(', '),
    rating: m.merchantBrief?.rating || 0,
    delivery_time: m.estimatedDeliveryTime ? `${m.estimatedDeliveryTime} mins` : '',
    url: m.id ? `https://food.grab.com/sg/en/restaurant/${m.id}` : '',
    lat: m.latlng?.latitude || 0,
    lng: m.latlng?.longitude || 0,
  })).filter(r => r.name.length > 0 && r.url.length > 0);
}

async function callGrabAPIOnce(lat, lng, offset = 0) {
  const payload = {
    latlng: `${lat},${lng}`,
    keyword: '',
    offset,
    pageSize: PAGE_SIZE,
    countryCode: 'SG',
  };

  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  const response = await fetch('https://portal.grab.com/foodweb/guest/v2/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'X-Country-Code': 'SG',
      'X-Gfc-Country': 'SG',
      'X-Grab-Web-App-Version': '26yyTbu4FdOlUheJ4la26',
      'Origin': 'https://food.grab.com',
      'Referer': 'https://food.grab.com/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      'Cookie': cookieHeader,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return { ok: false, status: response.status, restaurants: [] };
  }

  const data = await response.json();
  return { ok: true, status: response.status, restaurants: parseRestaurants(data) };
}

async function callGrabAPIWithRetry(lat, lng, offset) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await callGrabAPIOnce(lat, lng, offset);

      if (result.ok) {
        return result;
      }

      const retryable = [429, 502, 503, 504].includes(result.status);
      if (!retryable) {
        console.log(`    ❌ API ${result.status} at offset ${offset}`);
        return result;
      }

      const waitMs = Math.min(60000, 5000 * attempt);
      console.log(`    ⚠️  API ${result.status} at offset ${offset}, retry ${attempt}/${MAX_RETRIES} in ${waitMs / 1000}s...`);

      if (attempt === 2) {
        await refreshCookies(true);
      }

      await sleep(waitMs);
    } catch (error) {
      const waitMs = Math.min(30000, 3000 * attempt);
      console.log(`    ⚠️  Request error at offset ${offset}: ${error.message}, retry ${attempt}/${MAX_RETRIES}...`);
      await sleep(waitMs);
    }
  }

  return { ok: false, status: 429, restaurants: [] };
}

async function preflightCheck() {
  const test = DISTRICTS[0];
  console.log('🔍 Pre-flight API check...');
  const result = await callGrabAPIWithRetry(test.lat, test.lng, 0);

  if (!result.ok) {
    console.log(`❌ Grab API not ready (status ${result.status}). Wait 30–60 min and try again.\n`);
    return false;
  }

  console.log(`✅ API ready (${result.restaurants.length} restaurants on test call)\n`);
  return true;
}

async function scrapeDistrict(district, index, total) {
  console.log(`[${index}/${total}] ${district.name}`);

  const allRestaurants = [];
  const seenUrls = new Set();
  let offset = 0;
  let pageNum = 1;

  while (true) {
    const result = await callGrabAPIWithRetry(district.lat, district.lng, offset);

    if (!result.ok) {
      console.log(`  ❌ Stopping ${district.name} — rate limited or API error (${result.status})\n`);
      return { success: false, count: allRestaurants.length };
    }

    if (result.restaurants.length === 0) {
      break;
    }

    let newOnPage = 0;
    for (const restaurant of result.restaurants) {
      if (!seenUrls.has(restaurant.url)) {
        seenUrls.add(restaurant.url);
        allRestaurants.push(restaurant);
        newOnPage++;
      }
    }

    console.log(`  📄 Page ${pageNum} (offset ${offset}): ${result.restaurants.length} fetched, ${newOnPage} new`);
    offset += PAGE_SIZE;
    pageNum++;

    await sleep(PAGE_DELAY_MS);
  }

  console.log(`  ✅ Total: ${allRestaurants.length} restaurants`);

  if (allRestaurants.length > 0) {
    const first3 = allRestaurants.slice(0, 3).map(r => r.name).join(', ');
    console.log(`  📋 First 3: ${first3}`);

    const rows = allRestaurants.map(r => ({
      name: r.name,
      cuisine: r.cuisine,
      rating: r.rating,
      grab_url: r.url,
      district: district.name,
      delivery_time: r.delivery_time,
      health_score: 0,
      latitude: r.lat,
      longitude: r.lng,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('restaurants')
      .upsert(rows, { onConflict: 'grab_url' });

    if (error) {
      console.log(`  ❌ Upsert error: ${error.message}`);
      return { success: false, count: allRestaurants.length };
    }

    console.log(`  💾 Upserted ${rows.length} restaurants`);
  }

  console.log('');
  return { success: true, count: allRestaurants.length };
}

async function main() {
  console.log('🚀 Restaurant Extraction (batched, resumable)\n');

  await initSupabase();

  const cookiesOk = await refreshCookies();
  if (!cookiesOk) {
    process.exit(1);
  }

  const progress = await readProgress();
  let startIndex = progress.nextDistrictIndex;

  if (startIndex >= DISTRICTS.length) {
    console.log('✅ All districts already completed. Resetting progress to start over.\n');
    startIndex = 0;
    await writeProgress(0);
  }

  const apiReady = await preflightCheck();
  if (!apiReady) {
    process.exit(1);
  }

  const endIndex = Math.min(startIndex + BATCH_SIZE, DISTRICTS.length);
  const batch = DISTRICTS.slice(startIndex, endIndex);

  console.log(`📦 Batch: districts ${startIndex + 1}–${endIndex} of ${DISTRICTS.length} (${batch.map(d => d.name).join(', ')})\n`);

  let nextIndex = startIndex;

  for (let i = 0; i < batch.length; i++) {
    if (i > 0) {
      await refreshCookies(true);
    }

    const districtIndex = startIndex + i;
    const result = await scrapeDistrict(batch[i], districtIndex + 1, DISTRICTS.length);

    if (!result.success) {
      console.log(`⏸️  Batch paused at district ${districtIndex + 1} (${batch[i].name})`);
      console.log(`   Progress saved at index ${nextIndex}. Wait 30–60 min, then run again.\n`);
      await writeProgress(nextIndex);
      process.exit(1);
    }

    nextIndex = districtIndex + 1;
    await writeProgress(nextIndex);
  }

  console.log(`${'='.repeat(60)}`);
  if (nextIndex >= DISTRICTS.length) {
    console.log('✅ All districts complete!');
    await writeProgress(0);
  } else {
    const next = DISTRICTS[nextIndex];
    console.log(`✅ Batch complete!`);
    console.log(`➡️  Next run will start at district ${nextIndex + 1}: ${next.name}`);
    console.log(`   Wait 30–60 min before running again to avoid rate limits.`);
  }
  console.log(`${'='.repeat(60)}\n`);
}

main().catch(console.error);
