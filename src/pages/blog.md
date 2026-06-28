---
layout: blog.njk
title: Blog
date: 2019-09-02
pagination:
  data: collections.post
  size: 20
permalink: "blog{% if pagination.pageNumber > 0 %}/page/{{ pagination.pageNumber }}{% endif %}/index.html"
metaDescription: A collection of random thoughts
subtitle: A collection of random thoughts
eleventyNavigation:
  key: Blog
  order: 2
---