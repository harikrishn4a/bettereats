#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function parseIdRange() {
  const startId = parseInt(process.argv[2], 10);
  const endId = parseInt(process.argv[3], 10);

  if (!startId || !endId) {
    console.error('Usage: node regenerate-urls-range.js <startId> <endId>');
    console.error('Example: node regenerate-urls-range.js 1147 1194');
    process.exit(1);
  }

  if (startId > endId) {
    console.error('❌ startId must be <= endId');
    process.exit(1);
  }

  return { startId, endId };
}

function generateSlug(restaurantName) {
  return restaurantName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function generateGrabUrl(restaurantName, merchantId) {
  const slug = generateSlug(restaurantName);
  return `https://food.grab.com/sg/en/restaurant/${slug}/${merchantId}`;
}

function extractMerchantId(currentUrl) {
  const match = currentUrl.match(/\/([^/]+)$/);
  if (match && match[1]) {
    return match[1];
  }
  const parts = currentUrl.split('/');
  const lastPart = parts[parts.length - 1];
  if (lastPart && (lastPart.startsWith('4-') || lastPart.startsWith('SGDD'))) {
    return lastPart;
  }
  return null;
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

async function regenerateUrlsInRange() {
  const { startId, endId } = parseIdRange();

  console.log(`🔄 Regenerating Grab URLs for restaurant IDs ${startId}–${endId}...\n`);

  const restaurants = await fetchRestaurantsInRange(startId, endId);
  console.log(`📍 Found ${restaurants.length} restaurants in range\n`);

  let updated = 0;
  let skipped = 0;

  for (const restaurant of restaurants) {
    const merchantId = extractMerchantId(restaurant.grab_url);
    if (!merchantId) {
      console.log(`  ⚠️  [${restaurant.id}] ${restaurant.name} — could not extract merchant ID`);
      skipped++;
      continue;
    }

    const newUrl = generateGrabUrl(restaurant.name, merchantId);

    if (newUrl === restaurant.grab_url) {
      console.log(`  ✓  [${restaurant.id}] ${restaurant.name} — already correct`);
      continue;
    }

    const { error: updateError } = await supabase
      .from('restaurants')
      .update({ grab_url: newUrl })
      .eq('id', restaurant.id);

    if (updateError) {
      console.log(`  ❌ [${restaurant.id}] ${restaurant.name} — ${updateError.message}`);
      skipped++;
    } else {
      console.log(`  ✅ [${restaurant.id}] ${restaurant.name}`);
      console.log(`     ${restaurant.grab_url}`);
      console.log(`     → ${newUrl}`);
      updated++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ Complete!');
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ Updated: ${updated}`);
  console.log(`⚠️  Skipped: ${skipped}`);
  console.log(`📊 Processed: ${restaurants.length}`);
  console.log(`${'='.repeat(60)}\n`);
}

regenerateUrlsInRange().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
