const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const importRoot = path.join(root, 'wordpress-import', 'output');
const exportPath = path.join(root, 'wordpress-import', 'export.xml');
const assetRoot = path.join(root, 'src', 'assets', 'img', 'wordpress-import');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function readMarkdown(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    return { frontMatter: {}, body: raw.trim() };
  }

  const frontMatterText = match[1];
  const body = match[2] || '';
  const frontMatter = {};

  for (const line of frontMatterText.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;

    const [, key, value] = m;
    const trimmed = value.trim();
    if (trimmed === '') {
      frontMatter[key] = '';
      continue;
    }

    if (/^\[.*\]$/.test(trimmed)) {
      try {
        const parsed = JSON.parse(trimmed.replace(/'/g, '"'));
        frontMatter[key] = parsed;
      } catch {
        frontMatter[key] = trimmed;
      }
      continue;
    }

    if (/^".*"$/.test(trimmed) || /^'.*'$/.test(trimmed)) {
      frontMatter[key] = trimmed.slice(1, -1);
      continue;
    }

    frontMatter[key] = trimmed;
  }

  return { frontMatter, body: body.trim() };
}

function stringifyFrontMatter(data) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else if (typeof value === 'object') {
      lines.push(`${key}:`);
      for (const [subKey, subValue] of Object.entries(value)) {
        lines.push(`  ${subKey}: ${subValue}`);
      }
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function copyAsset(sourcePath, destinationDir) {
  ensureDir(destinationDir);
  const fileName = path.basename(sourcePath);
  const destinationPath = path.join(destinationDir, fileName);
  const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif']);
  const ext = path.extname(sourcePath).toLowerCase();
  if (!fs.existsSync(destinationPath)) {
    fs.copyFileSync(sourcePath, destinationPath);
  }
  const assetUrl = path.posix.join('/assets/img/wordpress-import', path.relative(assetRoot, destinationPath).replace(/\\/g, '/'));
  return {
    assetUrl,
    isImage: allowedExtensions.has(ext),
  };
}

function rewriteAssets(markdown, sourceDir, assetBaseDir, slug, contentType) {
  let output = markdown;

  output = output.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, altText, target) => {
    const trimmed = target.trim();
    if (!trimmed || /^https?:\/\//i.test(trimmed) || trimmed.startsWith('mailto:') || trimmed.startsWith('#')) {
      return match;
    }
    const normalizedTarget = trimmed.replace(/^\.\//, '');
    const candidatePaths = [
      path.join(sourceDir, normalizedTarget),
      path.join(sourceDir, 'images', normalizedTarget.replace(/^images\//, '')),
      path.join(sourceDir, normalizedTarget.replace(/^images\//, '')),
      path.join(path.dirname(sourceDir), 'images', normalizedTarget.replace(/^images\//, '')),
      path.join(path.dirname(sourceDir), normalizedTarget.replace(/^images\//, '')),
    ];
    const existing = candidatePaths.find((candidate) => fs.existsSync(candidate));
    if (!existing) {
      return match;
    }
    const assetInfo = copyAsset(existing, path.join(assetBaseDir, slug));
    if (!assetInfo) {
      return match;
    }
    if (!assetInfo.isImage) {
      return `[${altText || 'Media file'}](${assetInfo.assetUrl})`;
    }
    return `![${altText}](${assetInfo.assetUrl})`;
  });

  output = output.replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi, (match, target) => {
    const trimmed = target.trim();
    if (!trimmed || /^https?:\/\//i.test(trimmed) || trimmed.startsWith('mailto:') || trimmed.startsWith('#')) {
      return match;
    }
    const normalizedTarget = trimmed.replace(/^\.\//, '');
    const candidatePaths = [
      path.join(sourceDir, normalizedTarget),
      path.join(sourceDir, 'images', normalizedTarget.replace(/^images\//, '')),
      path.join(sourceDir, normalizedTarget.replace(/^images\//, '')),
      path.join(path.dirname(sourceDir), 'images', normalizedTarget.replace(/^images\//, '')),
      path.join(path.dirname(sourceDir), normalizedTarget.replace(/^images\//, '')),
    ];
    const existing = candidatePaths.find((candidate) => fs.existsSync(candidate));
    if (!existing) {
      return match;
    }
    const assetInfo = copyAsset(existing, path.join(assetBaseDir, slug));
    if (!assetInfo) {
      return match;
    }
    return match.replace(target, assetInfo.assetUrl);
  });

  return output;
}

function extractSummary(body) {
  const stripped = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '')
    .replace(/\*\*|__|`/g, '')
    .trim();
  const firstParagraph = stripped.split(/\n\s*\n/).find(Boolean) || '';
  return firstParagraph.length > 180 ? `${firstParagraph.slice(0, 177).trimEnd()}...` : firstParagraph;
}

function resolveDate(inputDate) {
  if (!inputDate) return new Date().toISOString();
  const trimmed = String(inputDate).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed;
  return trimmed;
}

function parseWordPressExportTaxonomy() {
  if (!fs.existsSync(exportPath)) {
    return new Map();
  }

  const xml = fs.readFileSync(exportPath, 'utf8');
  const lookup = new Map();
  const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

  for (const [, itemText] of itemMatches) {
    const postTypeMatch = itemText.match(/<wp:post_type>([\s\S]*?)<\/wp:post_type>/);
    const postType = postTypeMatch ? postTypeMatch[1].trim() : '';
    if (!['post', 'project'].includes(postType)) continue;

    const titleMatch = itemText.match(/<title>([\s\S]*?)<\/title>/);
    const title = titleMatch ? titleMatch[1].trim() : '';
    const postNameMatch = itemText.match(/<wp:post_name>([\s\S]*?)<\/wp:post_name>/);
    const postName = postNameMatch ? postNameMatch[1].trim() : '';
    const categories = [...itemText.matchAll(/<category[^>]*domain="category"[^>]*>([\s\S]*?)<\/category>/g)]
      .map((match) => match[1].replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);
    const tags = [...itemText.matchAll(/<category[^>]*domain="post_tag"[^>]*>([\s\S]*?)<\/category>/g)]
      .map((match) => match[1].replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);

    const taxonomy = { categories, tags };
    if (title) {
      lookup.set(slugify(title), taxonomy);
    }
    if (postName) {
      lookup.set(slugify(postName), taxonomy);
    }
  }

  return lookup;
}

function parseTags(frontMatter, taxonomyData, baseTag) {
  const direct = frontMatter.tags;
  const existingTags = Array.isArray(direct)
    ? direct
    : typeof direct === 'string'
      ? direct.split(',').map((item) => item.trim()).filter(Boolean)
      : [];
  const categories = Array.isArray(frontMatter.categories)
    ? frontMatter.categories
    : [];
  const taxonomyTags = Array.isArray(taxonomyData?.tags) ? taxonomyData.tags : [];
  const taxonomyCategories = Array.isArray(taxonomyData?.categories) ? taxonomyData.categories : [];
  const mergedTags = [...new Set([baseTag, ...existingTags, ...categories, ...taxonomyCategories, ...taxonomyTags].filter(Boolean))];
  return mergedTags;
}

function writePostFile(sourcePath, targetPath, title, date, body, frontMatter, contentType, baseTag, taxonomyData) {
  const targetName = path.basename(targetPath);
  const slug = path.basename(targetName, '.md');
  const assetBaseDir = path.join(assetRoot, contentType);
  const rewrittenBody = rewriteAssets(body, path.dirname(sourcePath), assetBaseDir, slug, contentType);
  const normalizedTags = Array.isArray(frontMatter.tags) ? frontMatter.tags : [frontMatter.tags];
  const finalTags = [...new Set([baseTag, ...normalizedTags].filter(Boolean))];
  const permalink = contentType === 'posts'
    ? `/posts/${slug}/index.html`
    : `/projects/${slug}/index.html`;
  const categories = Array.isArray(taxonomyData?.categories) && taxonomyData.categories.length
    ? taxonomyData.categories
    : undefined;
  const frontMatterData = {
    title,
    date: resolveDate(date),
    summary: extractSummary(rewrittenBody),
    ...(categories ? { categories } : {}),
    tags: parseTags(frontMatter, taxonomyData, baseTag),
    permalink,
  };

  const content = `${stringifyFrontMatter(frontMatterData)}\n\n${rewrittenBody}`;
  fs.writeFileSync(targetPath, content, 'utf8');
  return targetPath;
}

function writePageFile(sourcePath, targetPath, title, date, body, permalink, navKey, navOrder) {
  const assetBaseDir = path.join(assetRoot, 'pages');
  const rewrittenBody = rewriteAssets(body, path.dirname(sourcePath), assetBaseDir, slugify(title), 'pages');
  const frontMatter = {
    title,
    date: resolveDate(date),
    permalink,
    eleventyNavigation: {
      key: navKey,
      order: navOrder,
    },
  };
  const content = `${stringifyFrontMatter(frontMatter)}\n\n${rewrittenBody}`;
  fs.writeFileSync(targetPath, content, 'utf8');
}

function writeHomeFile(sourcePath) {
  const { frontMatter, body } = readMarkdown(sourcePath);
  const title = frontMatter.title || 'Home';
  const rewrittenBody = rewriteAssets(body, path.dirname(sourcePath), path.join(assetRoot, 'pages'), slugify(title), 'pages');
  const homeData = {
    title,
    image: '/assets/img/fern-in-hand.jpeg',
    image_alt: 'Eva Maria Veitmaa',
    body: rewrittenBody,
  };
  fs.writeFileSync(path.join(root, 'src', '_data', 'home.json'), `${JSON.stringify(homeData, null, 2)}\n`, 'utf8');
}

async function processPosts(exportTaxonomy) {
  const postsDir = path.join(importRoot, 'posts');
  const targetDir = path.join(root, 'src', 'posts');
  ensureDir(targetDir);
  const files = fs.readdirSync(postsDir).filter((name) => name.endsWith('.md'));
  for (const file of files) {
    const filePath = path.join(postsDir, file);
    const { frontMatter, body } = readMarkdown(filePath);
    const title = frontMatter.title || path.basename(file, '.md');
    const slug = slugify(title || path.basename(file, '.md')) || path.basename(file, '.md');
    const targetPath = path.join(targetDir, `wordpress-${slug}.md`);
    const taxonomyData = exportTaxonomy.get(slug) || exportTaxonomy.get(slugify(path.basename(file, '.md').replace(/^wordpress-/, '')));
    writePostFile(filePath, targetPath, title, frontMatter.date, body, frontMatter, 'posts', 'post', taxonomyData);
  }
}

async function processProjects(exportTaxonomy) {
  const projectsDir = path.join(importRoot, 'custom', 'rara-portfolio');
  const targetDir = path.join(root, 'src', 'projects');
  ensureDir(targetDir);
  const files = fs.readdirSync(projectsDir).filter((name) => name.endsWith('.md'));
  for (const file of files) {
    const filePath = path.join(projectsDir, file);
    const { frontMatter, body } = readMarkdown(filePath);
    const title = frontMatter.title || path.basename(file, '.md');
    const slug = slugify(title || path.basename(file, '.md')) || path.basename(file, '.md');
    const targetPath = path.join(targetDir, `wordpress-${slug}.md`);
    const taxonomyData = exportTaxonomy.get(slug) || exportTaxonomy.get(slugify(path.basename(file, '.md').replace(/^wordpress-/, '')));
    writePostFile(filePath, targetPath, title, frontMatter.date, body, frontMatter, 'projects', 'project', taxonomyData);
  }
}

async function processPages() {
  const pageFiles = [
    { source: path.join(importRoot, 'pages', 'about-eva.md'), target: path.join(root, 'src', 'pages', 'wordpress-about-eva.md'), permalink: '/about-eva/index.html', navKey: 'About Eva', navOrder: 1 },
    { source: path.join(importRoot, 'pages', 'blog.md'), target: path.join(root, 'src', 'pages', 'wordpress-blog.md'), permalink: '/wordpress-blog/index.html', navKey: 'WordPress Blog', navOrder: 2 },
    { source: path.join(importRoot, 'pages', 'portfolio.md'), target: path.join(root, 'src', 'pages', 'wordpress-portfolio.md'), permalink: '/wordpress-portfolio/index.html', navKey: 'WordPress Portfolio', navOrder: 3 },
    { source: path.join(importRoot, 'pages', 'contact.md'), target: path.join(root, 'src', 'pages', 'wordpress-contact.md'), permalink: '/wordpress-contact/index.html', navKey: 'WordPress Contact', navOrder: 4 },
  ];

  for (const item of pageFiles) {
    const { frontMatter, body } = readMarkdown(item.source);
    const title = frontMatter.title || path.basename(item.source, '.md');
    const date = frontMatter.date || new Date().toISOString();
    writePageFile(item.source, item.target, title, date, body, item.permalink, item.navKey, item.navOrder);
  }
}

ensureDir(assetRoot);
const exportTaxonomy = parseWordPressExportTaxonomy();
processPosts(exportTaxonomy);
processProjects(exportTaxonomy);
processPages();

fs.rmSync(path.join(root, 'src', 'posts', 'wordpress-import'), { recursive: true, force: true });
fs.rmSync(path.join(root, 'src', 'projects', 'wordpress-import'), { recursive: true, force: true });

console.log('WordPress import migration completed.');
