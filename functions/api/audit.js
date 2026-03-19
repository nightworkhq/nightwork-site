/**
 * Nightwork Free Web Audit - Cloudflare Pages Function
 *
 * Runs automated website checks and returns a scored report.
 * Serverless, scales infinitely, costs nothing.
 */

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Normalize URL
  let normalizedUrl = targetUrl.trim();
  if (!normalizedUrl.startsWith('http')) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  try {
    const results = await runAudit(normalizedUrl);
    return new Response(JSON.stringify(results), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

async function runAudit(targetUrl) {
  const parsedUrl = new URL(targetUrl);
  const domain = parsedUrl.hostname;
  const startTime = Date.now();

  const sections = {};

  // 1. SSL & Security
  sections.ssl = await checkSSL(targetUrl);

  // 2. Performance
  const { section: perfSection, html } = await checkPerformance(targetUrl);
  sections.performance = perfSection;

  // 3. Security Headers
  sections.headers = await checkHeaders(targetUrl);

  // 4. SEO
  sections.seo = checkSEO(html, targetUrl);

  // Calculate overall
  let totalScore = 0, totalMax = 0;
  for (const s of Object.values(sections)) {
    totalScore += s.score;
    totalMax += s.max;
  }

  const percentage = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;
  let grade;
  if (percentage >= 90) grade = 'A';
  else if (percentage >= 75) grade = 'B';
  else if (percentage >= 60) grade = 'C';
  else if (percentage >= 40) grade = 'D';
  else grade = 'F';

  // Generate recommendations with affiliate context
  const recommendations = generateRecommendations(sections);

  return {
    url: targetUrl,
    domain,
    timestamp: new Date().toISOString(),
    auditDuration: Date.now() - startTime,
    score: totalScore,
    maxScore: totalMax,
    percentage,
    grade,
    sections,
    recommendations
  };
}

async function checkSSL(url) {
  const section = { name: 'SSL & Security', checks: [], score: 0, max: 20 };

  try {
    // Check HTTPS works
    const resp = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    const finalUrl = resp.url;

    section.checks.push({
      check: 'HTTPS Connection',
      pass: finalUrl.startsWith('https://'),
      detail: finalUrl.startsWith('https://') ? 'Site loads over HTTPS' : 'Site not using HTTPS'
    });
    if (finalUrl.startsWith('https://')) section.score += 10;

    // Check HTTP redirect
    try {
      const httpUrl = url.replace('https://', 'http://');
      const httpResp = await fetch(httpUrl, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
      const redirectsToHttps = httpResp.url.startsWith('https://');
      section.checks.push({
        check: 'HTTP to HTTPS Redirect',
        pass: redirectsToHttps,
        detail: redirectsToHttps ? 'HTTP automatically redirects to HTTPS' : 'HTTP does not redirect to HTTPS'
      });
      if (redirectsToHttps) section.score += 10;
    } catch {
      section.checks.push({ check: 'HTTP to HTTPS Redirect', pass: false, detail: 'Could not test redirect' });
    }

  } catch (err) {
    section.checks.push({ check: 'HTTPS Connection', pass: false, detail: 'Could not connect: ' + err.message });
  }

  return section;
}

async function checkPerformance(url) {
  const section = { name: 'Performance', checks: [], score: 0, max: 25 };
  let html = '';

  try {
    const start = Date.now();
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'NightworkAudit/1.0' },
      signal: AbortSignal.timeout(15000)
    });
    const loadTime = (Date.now() - start) / 1000;
    html = await resp.text();
    const sizeKB = new Blob([html]).size / 1024;

    // Load time
    const fast = loadTime < 2.0;
    section.checks.push({
      check: 'Page Load Time',
      pass: fast,
      detail: `${loadTime.toFixed(2)}s ${fast ? '(Good - under 2s)' : '(Slow - aim for under 2s)'}`
    });
    if (fast) section.score += 10;

    // Page size
    const small = sizeKB < 3000;
    section.checks.push({
      check: 'Page Size',
      pass: small,
      detail: `${sizeKB.toFixed(0)} KB ${small ? '(Good)' : '(Large - consider optimising images and code)'}`
    });
    if (small) section.score += 5;

    // Compression
    const encoding = resp.headers.get('content-encoding') || '';
    const compressed = encoding.includes('gzip') || encoding.includes('br');
    section.checks.push({
      check: 'Compression',
      pass: compressed,
      detail: compressed ? `Enabled (${encoding})` : 'Not detected - enable gzip or brotli compression'
    });
    if (compressed) section.score += 5;

    // Caching
    const cacheControl = resp.headers.get('cache-control') || '';
    const hasCaching = cacheControl.length > 0 && !cacheControl.includes('no-cache');
    section.checks.push({
      check: 'Cache Headers',
      pass: hasCaching,
      detail: hasCaching ? 'Cache-Control headers present' : 'No caching configured - browsers will re-download on every visit'
    });
    if (hasCaching) section.score += 5;

  } catch (err) {
    section.checks.push({ check: 'Page Load', pass: false, detail: 'Failed: ' + err.message });
  }

  return { section, html };
}

async function checkHeaders(url) {
  const section = { name: 'Security Headers', checks: [], score: 0, max: 20 };

  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000)
    });

    const headerChecks = {
      'strict-transport-security': { name: 'HSTS', desc: 'Forces HTTPS connections' },
      'x-content-type-options': { name: 'X-Content-Type-Options', desc: 'Prevents MIME type sniffing attacks' },
      'x-frame-options': { name: 'X-Frame-Options', desc: 'Prevents your site being embedded in iframes (clickjacking)' },
      'content-security-policy': { name: 'Content-Security-Policy', desc: 'Controls which resources browsers can load' }
    };

    for (const [header, info] of Object.entries(headerChecks)) {
      const present = resp.headers.has(header);
      section.checks.push({
        check: info.name,
        pass: present,
        detail: present ? `Present - ${info.desc}` : `Missing - ${info.desc}`
      });
      if (present) section.score += 5;
    }
  } catch (err) {
    section.checks.push({ check: 'Header Check', pass: false, detail: 'Failed: ' + err.message });
  }

  return section;
}

function checkSEO(html, url) {
  const section = { name: 'SEO & Discoverability', checks: [], score: 0, max: 35 };

  if (!html) {
    section.checks.push({ check: 'Page Content', pass: false, detail: 'No content to analyse' });
    return section;
  }

  // Title
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
  const title = titleMatch ? titleMatch[1].trim() : '';
  const titleGood = title.length >= 20 && title.length <= 70;
  section.checks.push({
    check: 'Title Tag',
    pass: titleGood,
    detail: title ? `"${title.substring(0, 60)}" (${title.length} chars${titleGood ? ', good length' : ', aim for 20-70 chars'})` : 'Missing - every page needs a title tag'
  });
  if (titleGood) section.score += 7;

  // Meta description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["'](.*?)["']/i);
  const desc = descMatch ? descMatch[1].trim() : '';
  const descGood = desc.length >= 50 && desc.length <= 160;
  section.checks.push({
    check: 'Meta Description',
    pass: descGood,
    detail: desc ? `${desc.length} chars ${descGood ? '(good length)' : '(aim for 50-160 chars)'}` : 'Missing - add a meta description for better search snippets'
  });
  if (descGood) section.score += 7;

  // H1
  const h1Matches = html.match(/<h1[^>]*>.*?<\/h1>/gis) || [];
  const singleH1 = h1Matches.length === 1;
  section.checks.push({
    check: 'H1 Heading',
    pass: singleH1,
    detail: singleH1 ? '1 H1 tag found (correct)' : `${h1Matches.length} H1 tags (should be exactly 1)`
  });
  if (singleH1) section.score += 5;

  // Viewport
  const hasViewport = /name=["']viewport["']/i.test(html);
  section.checks.push({
    check: 'Mobile Viewport',
    pass: hasViewport,
    detail: hasViewport ? 'Present - site is mobile-ready' : 'Missing - site may not display correctly on mobile'
  });
  if (hasViewport) section.score += 4;

  // Structured data
  const hasJsonLd = html.toLowerCase().includes('application/ld+json');
  section.checks.push({
    check: 'Structured Data (JSON-LD)',
    pass: hasJsonLd,
    detail: hasJsonLd ? 'Found - helps search engines and AI understand your business' : 'Missing - add JSON-LD to improve how search engines and AI represent you'
  });
  if (hasJsonLd) section.score += 6;

  // Open Graph
  const hasOG = /property=["']og:/i.test(html);
  section.checks.push({
    check: 'Open Graph Tags',
    pass: hasOG,
    detail: hasOG ? 'Present - social media shares will look good' : 'Missing - links shared on social media will look plain'
  });
  if (hasOG) section.score += 6;

  return section;
}

function generateRecommendations(sections) {
  const recs = [];

  // Check what failed and recommend fixes
  for (const section of Object.values(sections)) {
    for (const check of section.checks) {
      if (!check.pass) {
        switch (check.check) {
          case 'HTTPS Connection':
          case 'HTTP to HTTPS Redirect':
            recs.push({
              issue: check.check,
              priority: 'Critical',
              fix: 'Enable HTTPS with a free SSL certificate',
              tool: 'Cloudflare (free plan includes SSL)',
              link: 'https://www.cloudflare.com/en-gb/plans/free/'
            });
            break;
          case 'Page Load Time':
          case 'Compression':
            recs.push({
              issue: check.check,
              priority: 'High',
              fix: 'Enable compression and use a CDN to speed up your site',
              tool: 'Cloudflare CDN (free)',
              link: 'https://www.cloudflare.com/en-gb/plans/free/'
            });
            break;
          case 'HSTS':
          case 'X-Content-Type-Options':
          case 'X-Frame-Options':
          case 'Content-Security-Policy':
            recs.push({
              issue: check.check,
              priority: 'Medium',
              fix: 'Add security headers to your server configuration',
              tool: 'SecurityHeaders.com (free scanner)',
              link: 'https://securityheaders.com/'
            });
            break;
          case 'Structured Data (JSON-LD)':
            recs.push({
              issue: check.check,
              priority: 'High',
              fix: 'Add JSON-LD markup so search engines and AI assistants can understand your business',
              tool: 'Schema.org markup generator',
              link: 'https://technicalseo.com/tools/schema-markup-generator/'
            });
            break;
          case 'Meta Description':
          case 'Title Tag':
          case 'H1 Heading':
            recs.push({
              issue: check.check,
              priority: 'High',
              fix: 'Fix basic SEO elements to improve search visibility',
              tool: 'Ahrefs Webmaster Tools (free)',
              link: 'https://ahrefs.com/webmaster-tools'
            });
            break;
          case 'Open Graph Tags':
            recs.push({
              issue: check.check,
              priority: 'Medium',
              fix: 'Add Open Graph tags so social media shares show rich previews',
              tool: 'Facebook Sharing Debugger',
              link: 'https://developers.facebook.com/tools/debug/'
            });
            break;
          case 'Mobile Viewport':
            recs.push({
              issue: check.check,
              priority: 'Critical',
              fix: 'Add viewport meta tag for mobile responsiveness',
              tool: 'Google Mobile-Friendly Test',
              link: 'https://search.google.com/test/mobile-friendly'
            });
            break;
        }
      }
    }
  }

  return recs;
}
