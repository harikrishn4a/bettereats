#!/usr/bin/env node

import puppeteer from 'puppeteer-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

let supabase;

function parseIdRange() {
  const startId = parseInt(process.argv[2], 10);
  const endId = parseInt(process.argv[3], 10);

  if (!startId || !endId) {
    console.error('Usage: node extract-menus-range.js <startId> <endId>');
    console.error('Example: node extract-menus-range.js 1147 1194');
    process.exit(1);
  }

  if (startId > endId) {
    console.error('❌ startId must be <= endId');
    process.exit(1);
  }

  return { startId, endId };
}

async function initSupabase() {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('✅ Supabase connected\n');
}

async function connectToExistingBrowser() {
  const response = await fetch('http://127.0.0.1:9222/json/version');
  const data = await response.json();
  const wsEndpoint = data.webSocketDebuggerUrl;

  return puppeteer.connect({
    browserWSEndpoint: wsEndpoint,
  });
}

async function fetchRestaurantsInRange(startId, endId) {
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, name, grab_url')
    .gte('id', startId)
    .lte('id', endId)
    .order('id', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function extractMenuFromPage(page) {
  await new Promise(resolve => setTimeout(resolve, 2000));

  return page.evaluate(() => {
    const cards = [];
    const allDivs = Array.from(document.querySelectorAll('div'));

    allDivs.forEach(div => {
      try {
        const text = (div.innerText || '').trim();

        if (text.length < 15 || text.length > 400) return;

        const priceMatch = text.match(/S?\$?\s*(\d+\.?\d*)/);
        if (!priceMatch) return;

        const price = parseFloat(priceMatch[1]);

        if (price < 2 || price > 50) return;

        const noisePatterns = [
          /^\d+\s+Jalan/,
          /^For orders/,
          /Opening Hours/,
          /Deliver (to|date|time)/,
          /mins?\s*•/,
          /km\s*(away)?$/,
          /^\d+\.\d+$/,
        ];

        if (noisePatterns.some(pattern => pattern.test(text))) return;

        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length === 0) return;

        const name = lines[0];

        if (name.length < 4 || /^[\d\s.,•]+$/.test(name)) return;
        if (/Singapore|Restaurant|Home|Delivery|Rating/.test(name)) return;

        const description = lines
          .slice(1)
          .filter(l => !l.match(/^\d+\.?\d*$/) && !l.includes('$') && l.length > 5)
          .join(' ');

        const key = `${name}|${price}`;

        cards.push({
          name: name.substring(0, 150),
          description: description.substring(0, 250),
          price: parseFloat(price.toFixed(2)),
          key,
        });
      } catch (e) {}
    });

    const seen = new Set();
    const unique = [];

    cards.forEach(card => {
      if (!seen.has(card.key)) {
        unique.push({
          name: card.name,
          description: card.description,
          price: card.price,
        });
        seen.add(card.key);
      }
    });

    return unique;
  });
}

async function scrapeRestaurantMenu(restaurant, index, total) {
  console.log(`\n[${index}/${total}] ID ${restaurant.id}: ${restaurant.name}`);
  console.log(`  🔗 URL: ${restaurant.grab_url}`);

  let browser;
  let page;

  try {
    browser = await connectToExistingBrowser();
    page = await browser.newPage();

    await page.goto(restaurant.grab_url, { waitUntil: 'networkidle2', timeout: 15000 });
    console.log('  ✅ Page loaded');

    const menuItems = await extractMenuFromPage(page);
    console.log(`  🍽️  Found ${menuItems.length} menu items`);

    if (menuItems.length > 0) {
      const first3 = menuItems.slice(0, 3).map(m => `${m.name} ($${m.price})`).join(', ');
      console.log(`  📋 First 3: ${first3}`);

      const itemsToInsert = menuItems.map(item => ({
        restaurant_id: restaurant.id,
        name: item.name.substring(0, 255),
        description: item.description.substring(0, 1000),
        price: item.price,
        dietary_tags: [],
        health_score: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('menu_items')
        .insert(itemsToInsert);

      if (error) {
        if (!error.message.includes('duplicate')) {
          console.log(`  ❌ Save error: ${error.message}`);
          return { success: false, error: 'save_error' };
        }
        console.log(`  ✅ Saved ${menuItems.length} items (some duplicates)`);
      } else {
        console.log(`  ✅ Saved ${menuItems.length} items`);
      }

      return { success: true, items: menuItems.length };
    }

    console.log('  ⚠️  No menu items found');
    return { success: false, error: 'no_items' };
  } catch (error) {
    console.log(`  ❌ Error: ${error.message.substring(0, 100)}`);
    return { success: false, error: error.message };
  } finally {
    if (page) await page.close();
    if (browser) await browser.disconnect();
  }
}

async function main() {
  const { startId, endId } = parseIdRange();

  console.log(`🚀 Extracting Menus for restaurant IDs ${startId}–${endId}\n`);

  await initSupabase();

  const restaurants = await fetchRestaurantsInRange(startId, endId);
  console.log(`📍 Found ${restaurants.length} restaurants in range\n`);

  if (restaurants.length === 0) {
    console.log('No restaurants found in that ID range.');
    return;
  }

  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < restaurants.length; i++) {
    const result = await scrapeRestaurantMenu(restaurants[i], i + 1, restaurants.length);

    if (result.success) {
      successCount++;
    } else {
      failureCount++;
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ Complete!');
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failureCount}`);
  console.log(`${'='.repeat(60)}\n`);
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
