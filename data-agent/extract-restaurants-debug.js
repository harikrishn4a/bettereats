#!/usr/bin/env node

import puppeteer from 'puppeteer-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

let supabase;
let cookies = [];

async function initSupabase() {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
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

async function callGrabAPI(lat, lng, offset = 0) {
  const payload = { latlng: `${lat},${lng}`, keyword: '', offset, pageSize: 32, countryCode: 'SG' };
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

  if (!response.ok) return [];

  const data = await response.json();
  const merchants = data.searchResult?.searchMerchants || [];
  
  return merchants.map(m => ({
    name: m.address?.name || '',
    cuisine: (m.merchantBrief?.cuisine || []).join(', '),
    rating: m.merchantBrief?.rating || 0,
    url: `https://food.grab.com/sg/en/restaurant/${m.id}` || '',
    lat: m.latlng?.latitude || 0,
    lng: m.latlng?.longitude || 0
  })).filter(r => r.name.length > 0);
}

async function scrapeDistrict(district, index, total) {
  console.log(`\n[${index}/${total}] ${district.name}`);
  
  let allRestaurants = [];
  let offset = 0;
  let pageNum = 1;
  
  while (true) {
    const restaurants = await callGrabAPI(district.lat, district.lng, offset);
    
    if (restaurants.length === 0) {
      console.log(`  ⏹️  No more pages`);
      break;
    }
    
    console.log(`  📄 Page ${pageNum}: ${restaurants.length} restaurants`);
    allRestaurants = allRestaurants.concat(restaurants);
    
    offset += 32;
    pageNum++;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`  ✅ Total fetched: ${allRestaurants.length}`);
  
  // DEBUG: Show first 3 names
  if (allRestaurants.length > 0) {
    console.log(`  First 3: ${allRestaurants.slice(0, 3).map(r => r.name).join(', ')}`);
  }
  
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
          updated_at: new Date().toISOString()
        });
        seen.add(key);
      }
    });
    
    console.log(`  After dedup: ${uniqueRestaurants.length}`);
    
    if (uniqueRestaurants.length > 0) {
      const { error, data } = await supabase
        .from('restaurants')
        .insert(uniqueRestaurants);
      
      if (error) {
        console.log(`  ❌ DB Error: ${error.message}`);
      } else {
        console.log(`  💾 Saved: ${uniqueRestaurants.length}`);
      }
    }
  }
}

(async () => {
  await initSupabase();
  await refreshCookies();
  
  const DISTRICTS = [
    { name: 'Bukatok', lat: 1.34475, lng: 103.74804 },
    { name: 'Clementi', lat: 1.31511, lng: 103.76218 },
    { name: 'Jurong East', lat: 1.34081, lng: 103.74475 },
  ];
  
  for (let i = 0; i < DISTRICTS.length; i++) {
    await refreshCookies();
    await scrapeDistrict(DISTRICTS[i], i + 1, DISTRICTS.length);
  }
})();
