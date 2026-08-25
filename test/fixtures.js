/* Small, realistic page fixtures for the extractor tests. */

exports.wikipedia = `<!doctype html><html><head><title>Black hole - Wikipedia</title>
<meta property="og:title" content="Black hole - Wikipedia"></head><body>
<div id="mw-navigation"><ul><li><a href="/">Main page</a></li><li><a href="/rc">Recent changes</a></li><li><a href="/help">Help</a></li></ul></div>
<div id="mw-content-text"><div class="mw-parser-output">
<div class="shortdescription">Object that has a no-escape zone</div>
<p class="mw-empty-elt"></p>
<p>A <b>black hole</b> is a region of spacetime where gravity is so strong that nothing, including light and other electromagnetic waves, has enough energy to escape it.<sup class="reference">[1]</sup> Einstein's theory of general relativity predicts that a sufficiently compact mass can deform spacetime to form a black hole.</p>
<p>Objects whose gravitational fields are too strong for light to escape were first considered in the 18th century by John Michell and Pierre-Simon Laplace.</p>
<h2>How black holes form</h2>
<ol>
<li>A massive star exhausts the hydrogen fuel in its core.</li>
<li>Radiation pressure drops and the core collapses under its own gravity.</li>
<li>The outer layers rebound outward as a supernova explosion.</li>
<li>The remaining core is compressed past the point of neutron degeneracy.</li>
<li>An event horizon forms, and light can no longer escape the region.</li>
</ol>
<h2>Comparison of black hole classes</h2>
<table><caption>Black hole classes</caption>
<tr><th>Class</th><th>Approx. mass</th><th>Approx. radius</th></tr>
<tr><td>Supermassive</td><td>10^5–10^10 M☉</td><td>0.001–400 AU</td></tr>
<tr><td>Intermediate</td><td>10^3 M☉</td><td>10^3 km</td></tr>
<tr><td>Stellar</td><td>10 M☉</td><td>30 km</td></tr>
</table>
</div></div>
<footer><p>Privacy policy. All rights reserved. Subscribe to our newsletter for more.</p></footer>
</body></html>`;

exports.recipe = `<!doctype html><html><head><title>How to make cold brew coffee at home</title></head><body>
<nav><a href="/">Home</a><a href="/recipes">Recipes</a></nav>
<article>
<h1>How to make cold brew coffee</h1>
<p>Sign in to save this recipe. Subscribe to the newsletter for weekly recipes.</p>
<h2>Steps to make cold brew coffee</h2>
<ol>
<li>Coarsely grind 100 grams of coffee beans.</li>
<li>Combine the grounds with one litre of cold filtered water in a jar.</li>
<li>Stir gently until every ground is saturated, then seal the jar.</li>
<li>Steep in the refrigerator for 16 to 18 hours.</li>
<li>Strain through a paper filter into a clean bottle.</li>
</ol>
<p>Cold brew coffee is made by steeping coarsely ground beans in cold water for at least twelve hours, which extracts caffeine and flavour without the bitterness that hot water pulls from the grounds.</p>
</article>
<aside class="sidebar"><p>Related: how to make iced latte, how to make espresso, how to froth milk properly at home today.</p></aside>
</body></html>`;

exports.thin = `<!doctype html><html><head><title>Nothing here</title></head><body>
<div><p>Hi.</p><p>Bye.</p></div></body></html>`;

exports.hostile = `<!doctype html><html><head><title>Blocked</title></head><body>
<script>window.pwned = true; document.title = 'PWNED';</script>
<img src="x" onerror="window.pwned2 = true">
<p>Please enable JavaScript and cookies to continue. Sign in to view this page content now.</p>
</body></html>`;

/* A content-farm article: the intro repeats the query words without answering
 * anything, and the real answer sits mid-page under a heading. This is the
 * shape that made the old scorer look bad. */
exports.contentFarm = `<!doctype html><html><head><title>What Do Gazelles Eat? A Complete Guide</title></head><body>
<nav><a href="/">Home</a><a href="/animals">Animals</a></nav>
<article>
<h1>What Do Gazelles Eat?</h1>
<p>Gazelles are fascinating animals. In this article we'll explore what gazelles eat, where gazelles live, and why gazelles are so fast. Gazelles have long captured our imagination and gazelles remain a favourite of wildlife photographers everywhere.</p>
<p>Before we get to what gazelles eat, it helps to know a little about gazelles in general. There are nineteen species of gazelle spread across Africa and Asia, and each gazelle is adapted to the habitat it lives in.</p>
<h2>Diet</h2>
<p>The gazelle eats grasses, shoots, herbs and the leaves of low shrubs, and it browses on acacia foliage during the dry season when fresh grass becomes scarce.</p>
<h2>Predators</h2>
<p>Cheetahs, lions and wild dogs all hunt gazelle across the open savannah, which is why speed matters so much to them.</p>
</article>
<footer>Subscribe to our newsletter. All rights reserved.</footer>
</body></html>`;
