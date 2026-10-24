var background = (function() {
	// node_modules/wxt/dist/utils/define-background.mjs
	function defineBackground(arg) {
		if (arg == null || typeof arg === "function") return { main: arg };
		return arg;
	}
	// src/lib/url-utils.ts
	/**
	* Liste bekannter Tracking- und Session-Parameter, die niemals
	* identitätsstiftend für den Inhalt einer Seite sind.
	*/
	var TRACKING_PARAMS = /* @__PURE__ */ new Set([
		"utm_source",
		"utm_medium",
		"utm_campaign",
		"utm_term",
		"utm_content",
		"ref",
		"ref_",
		"fbclid",
		"gclid",
		"gclsrc",
		"dclid",
		"msclkid",
		"mc_eid",
		"zanpid",
		"igshid",
		"si",
		"feature",
		"spm_id_from",
		"from_source",
		"session_id",
		"sessionId"
	]);
	/**
	* Normalisiert eine Web-URL semantisch:
	* 1. Plattform-Ausnahmen (YouTube, Amazon, etc.), bei denen Parameter den Inhalt bestimmen
	* 2. Bereinigung von Tracking- und Session-Parametern
	* 3. Entfernung von URL-Hashes (#anchors)
	*/
	function cleanUrl(rawUrl) {
		try {
			const parsed = new URL(rawUrl);
			if (!parsed.protocol.startsWith("http")) return "";
			const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
			if (hostname === "youtube.com" || hostname === "m.youtube.com") {
				if (parsed.pathname === "/watch") {
					const videoId = parsed.searchParams.get("v");
					if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
				}
				if (parsed.pathname.startsWith("/shorts/")) {
					const id = parsed.pathname.split("/")[2];
					if (id) return `https://www.youtube.com/watch?v=${id}`;
				}
			} else if (hostname === "youtu.be") {
				const id = parsed.pathname.replace(/^\//, "").split("/")[0];
				if (id) return `https://www.youtube.com/watch?v=${id}`;
			}
			if (hostname.includes("amazon.")) {
				const asinMatch = parsed.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
				if (asinMatch) return `https://${hostname}/dp/${asinMatch[1].toUpperCase()}`;
			}
			if (hostname.includes("google.") && parsed.pathname === "/search") {
				const query = parsed.searchParams.get("q");
				if (query) return `https://${hostname}/search?q=${encodeURIComponent(query)}`;
			}
			if (hostname.includes("reddit.com")) {
				const redditMatch = parsed.pathname.match(/\/r\/([^/]+)\/comments\/([^/]+)/);
				if (redditMatch) return `https://www.reddit.com/r/${redditMatch[1].toLowerCase()}/comments/${redditMatch[2]}/`;
			}
			const searchParams = new URLSearchParams();
			parsed.searchParams.forEach((val, key) => {
				const lowerKey = key.toLowerCase();
				if (!TRACKING_PARAMS.has(lowerKey) && !lowerKey.startsWith("utm_")) searchParams.append(key, val);
			});
			searchParams.sort();
			const query = searchParams.toString();
			let pathname = parsed.pathname;
			if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
			return `${parsed.origin}${pathname}${query ? `?${query}` : ""}`;
		} catch {
			return "";
		}
	}
	// src/entrypoints/background.ts
	var SPACETIMEDB_SQL_URL = "https://maincloud.spacetimedb.com/v1/database/wepchat/sql";
	var BADGE_COLOR = "#2563EB";
	var countCache = /* @__PURE__ */ new Map();
	var CACHE_TTL_MS = 1e4;
	/**
	* Fragt die SpacetimeDB per leichtem HTTP-SQL-Endpoint ab
	*/
	async function fetchOnlineCount(url) {
		const cached = countCache.get(url);
		if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.count;
		const query = `SELECT count(*) as total FROM user_session WHERE current_url = '${url.replace(/'/g, "''")}'`;
		try {
			const response = await fetch(SPACETIMEDB_SQL_URL, {
				method: "POST",
				headers: { "Content-Type": "text/plain" },
				body: query
			});
			if (!response.ok) return 0;
			const data = await response.json();
			const count = Number(data?.[0]?.rows?.[0]?.[0] ?? 0);
			countCache.set(url, {
				count,
				timestamp: Date.now()
			});
			return count;
		} catch (err) {
			console.warn("[WepChat Background] Fehler beim Abrufen des Online-Counts:", err);
			return 0;
		}
	}
	/**
	* Formatiert den Badge-Text:
	* <= 1: leer (kein visueller Lärm)
	* 2 - 999: genaue Zahl
	* >= 1000: "99+"
	*/
	function formatBadgeText(count) {
		if (count <= 1) return "";
		if (count > 999) return "99+";
		return String(count);
	}
	/**
	* Aktualisiert den Badge für einen spezifischen Tab
	*/
	async function updateBadgeForTab(tabId, rawUrl) {
		if (!tabId || tabId === chrome.tabs.TAB_ID_NONE) return;
		if (!rawUrl) try {
			rawUrl = (await chrome.tabs.get(tabId))?.url;
		} catch {
			return;
		}
		const url = cleanUrl(rawUrl || "");
		if (!url) {
			chrome.action.setBadgeText({
				text: "",
				tabId
			}).catch(() => {});
			return;
		}
		const badgeText = formatBadgeText(await fetchOnlineCount(url));
		try {
			await chrome.action.setBadgeText({
				text: badgeText,
				tabId
			});
			if (badgeText) await chrome.action.setBadgeBackgroundColor({
				color: BADGE_COLOR,
				tabId
			});
		} catch (err) {}
	}
	var background_default = defineBackground(() => {
		if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error("Fehler bei setPanelBehavior:", error));
		chrome.action.onClicked.addListener(async (tab) => {
			if (tab.windowId && chrome.sidePanel && chrome.sidePanel.open) await chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
		});
		chrome.tabs.onActivated.addListener(async (activeInfo) => {
			await updateBadgeForTab(activeInfo.tabId);
		});
		chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
			if (changeInfo.url || changeInfo.status === "complete") await updateBadgeForTab(tabId, tab.url);
		});
	});
	// node_modules/wxt/dist/browser.mjs
	/**
	* Contains the `browser` export which you should use to access the extension
	* APIs in your project:
	*
	* ```ts
	* import { browser } from 'wxt/browser';
	*
	* browser.runtime.onInstalled.addListener(() => {
	*   // ...
	* });
	* ```
	*
	* @module wxt/browser
	*/
	var browser = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
	// node_modules/@webext-core/match-patterns/dist/index.mjs
	/**
	* Class for parsing and performing operations on match patterns.
	*
	* @example
	*   const pattern = new MatchPattern('*://google.com/*');
	*
	*   pattern.includes('https://google.com'); // true
	*   pattern.includes('http://youtube.com/watch?v=123'); // false
	*/
	var MatchPattern = class MatchPattern {
		static {
			this.PROTOCOLS = [
				"http",
				"https",
				"file",
				"ftp",
				"urn",
				"ws",
				"wss"
			];
		}
		/**
		* Parse a match pattern string. If it is invalid, the constructor will throw an
		* `InvalidMatchPattern` error.
		*
		* @param matchPattern The match pattern to parse.
		*/
		constructor(matchPattern) {
			if (matchPattern === "<all_urls>") {
				this.isAllUrls = true;
				this.protocolMatches = [...MatchPattern.PROTOCOLS];
				this.hostnameMatch = "*";
				this.pathnameMatch = "*";
			} else {
				const groups = /(.*):\/\/(.*?)(\/.*)/.exec(matchPattern);
				if (groups == null) throw new InvalidMatchPattern(matchPattern, "Incorrect format");
				const [_, protocol, hostname, pathname] = groups;
				validateProtocol(matchPattern, protocol);
				validateHostname(matchPattern, hostname);
				this.protocolMatches = protocol === "*" ? ["http", "https"] : [protocol];
				this.hostnameMatch = hostname;
				this.pathnameMatch = pathname;
			}
		}
		/** Check if a URL is included in a pattern. */
		includes(url) {
			const u = typeof url === "string" ? new URL(url) : url instanceof Location ? new URL(url.href) : url;
			if (this.isAllUrls) return !this.isUnknownProtocol(u);
			return !!this.protocolMatches.find((protocol) => {
				if (protocol === "http") return this.isHttpMatch(u);
				if (protocol === "https") return this.isHttpsMatch(u);
				if (protocol === "file") return this.isFileMatch(u);
				if (protocol === "ftp") return this.isFtpMatch(u);
				if (protocol === "urn") return this.isUrnMatch(u);
			});
		}
		isHttpMatch(url) {
			return url.protocol === "http:" && this.isHostPathMatch(url);
		}
		isHttpsMatch(url) {
			return url.protocol === "https:" && this.isHostPathMatch(url);
		}
		isHostPathMatch(url) {
			if (!this.hostnameMatch || !this.pathnameMatch) return false;
			const hostnameMatchRegexs = [this.convertPatternToRegex(this.hostnameMatch), this.convertPatternToRegex(this.hostnameMatch.replace(/^\*\./, ""))];
			const pathnameMatchRegex = this.convertPatternToRegex(this.pathnameMatch);
			return !!hostnameMatchRegexs.find((regex) => regex.test(url.hostname)) && pathnameMatchRegex.test(url.pathname);
		}
		isUnknownProtocol(url) {
			return !this.protocolMatches.includes(url.protocol.slice(0, -1));
		}
		isPathMatch(url) {
			if (!this.pathnameMatch) return false;
			return this.convertPatternToRegex(this.pathnameMatch).test(url.pathname);
		}
		isFileMatch(url) {
			return url.protocol === "file:" && this.isPathMatch(url);
		}
		isFtpMatch(_url) {
			throw Error("Not implemented: ftp:// pattern matching. Open a PR to add support");
		}
		isUrnMatch(_url) {
			throw Error("Not implemented: urn:// pattern matching. Open a PR to add support");
		}
		convertPatternToRegex(pattern) {
			const starsReplaced = this.escapeForRegex(pattern).replace(/\\\*/g, ".*");
			return RegExp(`^${starsReplaced}$`);
		}
		escapeForRegex(string) {
			return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
	};
	var InvalidMatchPattern = class extends Error {
		constructor(matchPattern, reason) {
			super(`Invalid match pattern "${matchPattern}": ${reason}`);
		}
	};
	function validateProtocol(matchPattern, protocol) {
		if (!MatchPattern.PROTOCOLS.includes(protocol) && protocol !== "*") throw new InvalidMatchPattern(matchPattern, `${protocol} not a valid protocol (${MatchPattern.PROTOCOLS.join(", ")})`);
	}
	function validateHostname(matchPattern, hostname) {
		if (hostname.includes(":")) throw new InvalidMatchPattern(matchPattern, `Hostname cannot include a port`);
		if (hostname.includes("*") && hostname.length > 1 && !hostname.startsWith("*.")) throw new InvalidMatchPattern(matchPattern, `If using a wildcard (*), it must go at the start of the hostname`);
	}
	// \0virtual:wxt-background-entrypoint?/Users/johann/MyBrew/WepChat/extension/src/entrypoints/background.ts
	function print(method, ...args) {
		if (typeof args[0] === "string") method(`[wxt] ${args.shift()}`, ...args);
		else method("[wxt]", ...args);
	}
	/** Wrapper around `console` with a "[wxt]" prefix */
	var logger = {
		debug: (...args) => print(console.debug, ...args),
		log: (...args) => print(console.log, ...args),
		warn: (...args) => print(console.warn, ...args),
		error: (...args) => print(console.error, ...args)
	};
	var ws;
	/** Connect to the websocket and listen for messages. */
	function getDevServerWebSocket() {
		if (ws == null) {
			const serverUrl = "ws://localhost:3000";
			logger.debug("Connecting to dev server @", serverUrl);
			ws = new WebSocket(serverUrl, "vite-hmr");
			ws.addWxtEventListener = ws.addEventListener.bind(ws);
			ws.sendCustom = (event, payload) => ws?.send(JSON.stringify({
				type: "custom",
				event,
				payload
			}));
			ws.addEventListener("open", () => {
				logger.debug("Connected to dev server");
			});
			ws.addEventListener("close", () => {
				logger.debug("Disconnected from dev server");
			});
			ws.addEventListener("error", (event) => {
				logger.error("Failed to connect to dev server", event);
			});
			ws.addEventListener("message", (e) => {
				try {
					const message = JSON.parse(e.data);
					if (message.type === "custom") ws?.dispatchEvent(new CustomEvent(message.event, { detail: message.data }));
				} catch (err) {
					logger.error("Failed to handle message", err);
				}
			});
		}
		return ws;
	}
	/** https://developer.chrome.com/blog/longer-esw-lifetimes/ */
	function keepServiceWorkerAlive() {
		setInterval(async () => {
			await browser.runtime.getPlatformInfo();
		}, 5e3);
	}
	function reloadContentScript(payload) {
		if (browser.runtime.getManifest().manifest_version == 2) reloadContentScriptMv2(payload);
		else reloadContentScriptMv3(payload);
	}
	async function reloadContentScriptMv3({ registration, contentScript }) {
		if (registration === "runtime") await reloadRuntimeContentScriptMv3(contentScript);
		else await reloadManifestContentScriptMv3(contentScript);
	}
	async function reloadManifestContentScriptMv3(contentScript) {
		const id = `wxt:${contentScript.js[0]}`;
		logger.log("Reloading content script:", contentScript);
		const registered = await browser.scripting.getRegisteredContentScripts();
		logger.debug("Existing scripts:", registered);
		const existing = registered.find((cs) => cs.id === id);
		if (existing) {
			logger.debug("Updating content script", existing);
			await browser.scripting.updateContentScripts([{
				...contentScript,
				id,
				css: contentScript.css ?? []
			}]);
		} else {
			logger.debug("Registering new content script...");
			await browser.scripting.registerContentScripts([{
				...contentScript,
				id,
				css: contentScript.css ?? []
			}]);
		}
		await reloadTabsForContentScript(contentScript);
	}
	async function reloadRuntimeContentScriptMv3(contentScript) {
		logger.log("Reloading content script:", contentScript);
		const registered = await browser.scripting.getRegisteredContentScripts();
		logger.debug("Existing scripts:", registered);
		const matches = registered.filter((cs) => {
			const hasJs = contentScript.js?.find((js) => cs.js?.includes(js));
			const hasCss = contentScript.css?.find((css) => cs.css?.includes(css));
			return hasJs || hasCss;
		});
		if (matches.length === 0) {
			logger.log("Content script is not registered yet, nothing to reload", contentScript);
			return;
		}
		await browser.scripting.updateContentScripts(matches);
		await reloadTabsForContentScript(contentScript);
	}
	async function reloadTabsForContentScript(contentScript) {
		const allTabs = await browser.tabs.query({});
		const matchPatterns = contentScript.matches.map((match) => new MatchPattern(match));
		const matchingTabs = allTabs.filter((tab) => {
			const url = tab.url;
			if (!url) return false;
			return !!matchPatterns.find((pattern) => pattern.includes(url));
		});
		await Promise.all(matchingTabs.map(async (tab) => {
			try {
				await browser.tabs.reload(tab.id);
			} catch (err) {
				logger.warn("Failed to reload tab:", err);
			}
		}));
	}
	async function reloadContentScriptMv2(_payload) {
		throw Error("TODO: reloadContentScriptMv2");
	}
	try {
		const ws = getDevServerWebSocket();
		ws.addWxtEventListener("wxt:reload-extension", () => {
			browser.runtime.reload();
		});
		ws.addWxtEventListener("wxt:reload-content-script", (event) => {
			reloadContentScript(event.detail);
		});
		ws.addEventListener("open", () => ws.sendCustom("wxt:background-initialized"));
		keepServiceWorkerAlive();
	} catch (err) {
		logger.error("Failed to setup web socket connection with dev server", err);
	}
	browser.commands.onCommand.addListener((command) => {
		if (command === "wxt:reload-extension") browser.runtime.reload();
	});
	var result;
	try {
		result = background_default.main();
		if (result instanceof Promise) console.warn("The background's main() function return a promise, but it must be synchronous");
	} catch (err) {
		logger.error("The background crashed on startup!");
		throw err;
	}
	return result;
})();

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2dyb3VuZC5qcyIsIm5hbWVzIjpbImJyb3dzZXIiLCJiYWNrZ3JvdW5kX2VudHJ5cG9pbnRfZGVmYXVsdCJdLCJzb3VyY2VzIjpbIi4uLy4uL25vZGVfbW9kdWxlcy93eHQvZGlzdC91dGlscy9kZWZpbmUtYmFja2dyb3VuZC5tanMiLCIuLi8uLi9zcmMvbGliL3VybC11dGlscy50cyIsIi4uLy4uL3NyYy9lbnRyeXBvaW50cy9iYWNrZ3JvdW5kLnRzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL0B3eHQtZGV2L2Jyb3dzZXIvc3JjL2luZGV4Lm1qcyIsIi4uLy4uL25vZGVfbW9kdWxlcy93eHQvZGlzdC9icm93c2VyLm1qcyIsIi4uLy4uL25vZGVfbW9kdWxlcy9Ad2ViZXh0LWNvcmUvbWF0Y2gtcGF0dGVybnMvZGlzdC9pbmRleC5tanMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8jcmVnaW9uIHNyYy91dGlscy9kZWZpbmUtYmFja2dyb3VuZC50c1xuZnVuY3Rpb24gZGVmaW5lQmFja2dyb3VuZChhcmcpIHtcblx0aWYgKGFyZyA9PSBudWxsIHx8IHR5cGVvZiBhcmcgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIHsgbWFpbjogYXJnIH07XG5cdHJldHVybiBhcmc7XG59XG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IGRlZmluZUJhY2tncm91bmQgfTtcbiIsIi8qKlxuICogTGlzdGUgYmVrYW5udGVyIFRyYWNraW5nLSB1bmQgU2Vzc2lvbi1QYXJhbWV0ZXIsIGRpZSBuaWVtYWxzXG4gKiBpZGVudGl0w6R0c3N0aWZ0ZW5kIGbDvHIgZGVuIEluaGFsdCBlaW5lciBTZWl0ZSBzaW5kLlxuICovXG5jb25zdCBUUkFDS0lOR19QQVJBTVMgPSBuZXcgU2V0KFtcbiAgJ3V0bV9zb3VyY2UnLFxuICAndXRtX21lZGl1bScsXG4gICd1dG1fY2FtcGFpZ24nLFxuICAndXRtX3Rlcm0nLFxuICAndXRtX2NvbnRlbnQnLFxuICAncmVmJyxcbiAgJ3JlZl8nLFxuICAnZmJjbGlkJyxcbiAgJ2djbGlkJyxcbiAgJ2djbHNyYycsXG4gICdkY2xpZCcsXG4gICdtc2Nsa2lkJyxcbiAgJ21jX2VpZCcsXG4gICd6YW5waWQnLFxuICAnaWdzaGlkJyxcbiAgJ3NpJywgLy8gU3BvdGlmeSAvIFlvdVR1YmUgc2hhcmUgdHJhY2tlclxuICAnZmVhdHVyZScsIC8vIFlvdVR1YmUgc2hhcmUgdHJhY2tlclxuICAnc3BtX2lkX2Zyb20nLCAvLyBCaWxpYmlsaSB0cmFja2VyXG4gICdmcm9tX3NvdXJjZScsXG4gICdzZXNzaW9uX2lkJyxcbiAgJ3Nlc3Npb25JZCcsXG5dKTtcblxuLyoqXG4gKiBOb3JtYWxpc2llcnQgZWluZSBXZWItVVJMIHNlbWFudGlzY2g6XG4gKiAxLiBQbGF0dGZvcm0tQXVzbmFobWVuIChZb3VUdWJlLCBBbWF6b24sIGV0Yy4pLCBiZWkgZGVuZW4gUGFyYW1ldGVyIGRlbiBJbmhhbHQgYmVzdGltbWVuXG4gKiAyLiBCZXJlaW5pZ3VuZyB2b24gVHJhY2tpbmctIHVuZCBTZXNzaW9uLVBhcmFtZXRlcm5cbiAqIDMuIEVudGZlcm51bmcgdm9uIFVSTC1IYXNoZXMgKCNhbmNob3JzKVxuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYW5VcmwocmF3VXJsOiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIGNvbnN0IHBhcnNlZCA9IG5ldyBVUkwocmF3VXJsKTtcbiAgICBpZiAoIXBhcnNlZC5wcm90b2NvbC5zdGFydHNXaXRoKCdodHRwJykpIHJldHVybiAnJztcblxuICAgIGNvbnN0IGhvc3RuYW1lID0gcGFyc2VkLmhvc3RuYW1lLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXnd3d1xcLi8sICcnKTtcblxuICAgIC8vIDEuIFlvdVR1YmVcbiAgICBpZiAoaG9zdG5hbWUgPT09ICd5b3V0dWJlLmNvbScgfHwgaG9zdG5hbWUgPT09ICdtLnlvdXR1YmUuY29tJykge1xuICAgICAgaWYgKHBhcnNlZC5wYXRobmFtZSA9PT0gJy93YXRjaCcpIHtcbiAgICAgICAgY29uc3QgdmlkZW9JZCA9IHBhcnNlZC5zZWFyY2hQYXJhbXMuZ2V0KCd2Jyk7XG4gICAgICAgIGlmICh2aWRlb0lkKSB7XG4gICAgICAgICAgcmV0dXJuIGBodHRwczovL3d3dy55b3V0dWJlLmNvbS93YXRjaD92PSR7dmlkZW9JZH1gO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBZb3VUdWJlIFNob3J0czogaHR0cHM6Ly93d3cueW91dHViZS5jb20vc2hvcnRzL3tpZH1cbiAgICAgIGlmIChwYXJzZWQucGF0aG5hbWUuc3RhcnRzV2l0aCgnL3Nob3J0cy8nKSkge1xuICAgICAgICBjb25zdCBwYXJ0cyA9IHBhcnNlZC5wYXRobmFtZS5zcGxpdCgnLycpO1xuICAgICAgICBjb25zdCBpZCA9IHBhcnRzWzJdO1xuICAgICAgICBpZiAoaWQpIHtcbiAgICAgICAgICByZXR1cm4gYGh0dHBzOi8vd3d3LnlvdXR1YmUuY29tL3dhdGNoP3Y9JHtpZH1gO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChob3N0bmFtZSA9PT0gJ3lvdXR1LmJlJykge1xuICAgICAgLy8geW91dHUuYmUvSUQgU2hvcnRsaW5rXG4gICAgICBjb25zdCBpZCA9IHBhcnNlZC5wYXRobmFtZS5yZXBsYWNlKC9eXFwvLywgJycpLnNwbGl0KCcvJylbMF07XG4gICAgICBpZiAoaWQpIHtcbiAgICAgICAgcmV0dXJuIGBodHRwczovL3d3dy55b3V0dWJlLmNvbS93YXRjaD92PSR7aWR9YDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyAyLiBBbWF6b24gKGFtYXpvbi5kZSwgYW1hem9uLmNvbSwgZXRjLilcbiAgICBpZiAoaG9zdG5hbWUuaW5jbHVkZXMoJ2FtYXpvbi4nKSkge1xuICAgICAgY29uc3QgYXNpbk1hdGNoID0gcGFyc2VkLnBhdGhuYW1lLm1hdGNoKC9cXC8oPzpkcHxncFxcL3Byb2R1Y3QpXFwvKFtBLVowLTldezEwfSkvaSk7XG4gICAgICBpZiAoYXNpbk1hdGNoKSB7XG4gICAgICAgIHJldHVybiBgaHR0cHM6Ly8ke2hvc3RuYW1lfS9kcC8ke2FzaW5NYXRjaFsxXS50b1VwcGVyQ2FzZSgpfWA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gMy4gR29vZ2xlIFN1Y2hlXG4gICAgaWYgKGhvc3RuYW1lLmluY2x1ZGVzKCdnb29nbGUuJykgJiYgcGFyc2VkLnBhdGhuYW1lID09PSAnL3NlYXJjaCcpIHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gcGFyc2VkLnNlYXJjaFBhcmFtcy5nZXQoJ3EnKTtcbiAgICAgIGlmIChxdWVyeSkge1xuICAgICAgICByZXR1cm4gYGh0dHBzOi8vJHtob3N0bmFtZX0vc2VhcmNoP3E9JHtlbmNvZGVVUklDb21wb25lbnQocXVlcnkpfWA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gNC4gUmVkZGl0XG4gICAgaWYgKGhvc3RuYW1lLmluY2x1ZGVzKCdyZWRkaXQuY29tJykpIHtcbiAgICAgIGNvbnN0IHJlZGRpdE1hdGNoID0gcGFyc2VkLnBhdGhuYW1lLm1hdGNoKC9cXC9yXFwvKFteL10rKVxcL2NvbW1lbnRzXFwvKFteL10rKS8pO1xuICAgICAgaWYgKHJlZGRpdE1hdGNoKSB7XG4gICAgICAgIHJldHVybiBgaHR0cHM6Ly93d3cucmVkZGl0LmNvbS9yLyR7cmVkZGl0TWF0Y2hbMV0udG9Mb3dlckNhc2UoKX0vY29tbWVudHMvJHtyZWRkaXRNYXRjaFsyXX0vYDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyA1LiBHZW5lcmlzY2hlciBTdGFuZGFyZC1QZmFkOlxuICAgIC8vIFRyYWNraW5nLVBhcmFtZXRlciBlbnRmZXJuZW4sIGFsbGUgYW5kZXJlbiAoei4gQi4gP2lkPTEyMywgP3BhZ2U9Mikgc29ydGllcnQgYmVoYWx0ZW5cbiAgICBjb25zdCBzZWFyY2hQYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKCk7XG4gICAgcGFyc2VkLnNlYXJjaFBhcmFtcy5mb3JFYWNoKCh2YWwsIGtleSkgPT4ge1xuICAgICAgY29uc3QgbG93ZXJLZXkgPSBrZXkudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmICghVFJBQ0tJTkdfUEFSQU1TLmhhcyhsb3dlcktleSkgJiYgIWxvd2VyS2V5LnN0YXJ0c1dpdGgoJ3V0bV8nKSkge1xuICAgICAgICBzZWFyY2hQYXJhbXMuYXBwZW5kKGtleSwgdmFsKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHNlYXJjaFBhcmFtcy5zb3J0KCk7XG4gICAgY29uc3QgcXVlcnkgPSBzZWFyY2hQYXJhbXMudG9TdHJpbmcoKTtcblxuICAgIC8vIFRyYWlsaW5nIFNsYXNoIGVudGZlcm5lbiAoYXXDn2VyIGJlaSBSb290IFwiL1wiKVxuICAgIGxldCBwYXRobmFtZSA9IHBhcnNlZC5wYXRobmFtZTtcbiAgICBpZiAocGF0aG5hbWUubGVuZ3RoID4gMSAmJiBwYXRobmFtZS5lbmRzV2l0aCgnLycpKSB7XG4gICAgICBwYXRobmFtZSA9IHBhdGhuYW1lLnNsaWNlKDAsIC0xKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYCR7cGFyc2VkLm9yaWdpbn0ke3BhdGhuYW1lfSR7cXVlcnkgPyBgPyR7cXVlcnl9YCA6ICcnfWA7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnJztcbiAgfVxufVxuIiwiaW1wb3J0IHsgY2xlYW5VcmwgfSBmcm9tICdAL2xpYi91cmwtdXRpbHMnO1xuXG5jb25zdCBTUEFDRVRJTUVEQl9TUUxfVVJMID0gJ2h0dHBzOi8vbWFpbmNsb3VkLnNwYWNldGltZWRiLmNvbS92MS9kYXRhYmFzZS93ZXBjaGF0L3NxbCc7XG5jb25zdCBCQURHRV9DT0xPUiA9ICcjMjU2M0VCJzsgLy8gV2VwQ2hhdCBCbGF1XG5cbi8vIEt1cnplciBJbi1NZW1vcnkgQ2FjaGUgcHJvIFVSTCAoMTBzKSwgdW0gcmVkdW5kYW50ZSBSZXF1ZXN0cyBiZWltIHNjaG5lbGxlbiBIaW4tIHVuZCBIZXJ3ZWNoc2VsbiB6dSBtaW5pbWllcmVuXG5jb25zdCBjb3VudENhY2hlID0gbmV3IE1hcDxzdHJpbmcsIHsgY291bnQ6IG51bWJlcjsgdGltZXN0YW1wOiBudW1iZXIgfT4oKTtcbmNvbnN0IENBQ0hFX1RUTF9NUyA9IDEwXzAwMDtcblxuLyoqXG4gKiBGcmFndCBkaWUgU3BhY2V0aW1lREIgcGVyIGxlaWNodGVtIEhUVFAtU1FMLUVuZHBvaW50IGFiXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZldGNoT25saW5lQ291bnQodXJsOiBzdHJpbmcpOiBQcm9taXNlPG51bWJlcj4ge1xuICBjb25zdCBjYWNoZWQgPSBjb3VudENhY2hlLmdldCh1cmwpO1xuICBpZiAoY2FjaGVkICYmIERhdGUubm93KCkgLSBjYWNoZWQudGltZXN0YW1wIDwgQ0FDSEVfVFRMX01TKSB7XG4gICAgcmV0dXJuIGNhY2hlZC5jb3VudDtcbiAgfVxuXG4gIC8vIEVzY2FwZSBlaW5mYWNoZXMgQW5mw7xocnVuZ3N6ZWljaGVuIGbDvHIgU1FMXG4gIGNvbnN0IGVzY2FwZWRVcmwgPSB1cmwucmVwbGFjZSgvJy9nLCBcIicnXCIpO1xuICBjb25zdCBxdWVyeSA9IGBTRUxFQ1QgY291bnQoKikgYXMgdG90YWwgRlJPTSB1c2VyX3Nlc3Npb24gV0hFUkUgY3VycmVudF91cmwgPSAnJHtlc2NhcGVkVXJsfSdgO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChTUEFDRVRJTUVEQl9TUUxfVVJMLCB7XG4gICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6ICd0ZXh0L3BsYWluJyB9LFxuICAgICAgYm9keTogcXVlcnksXG4gICAgfSk7XG5cbiAgICBpZiAoIXJlc3BvbnNlLm9rKSByZXR1cm4gMDtcbiAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVzcG9uc2UuanNvbigpO1xuICAgIGNvbnN0IGNvdW50ID0gTnVtYmVyKGRhdGE/LlswXT8ucm93cz8uWzBdPy5bMF0gPz8gMCk7XG5cbiAgICBjb3VudENhY2hlLnNldCh1cmwsIHsgY291bnQsIHRpbWVzdGFtcDogRGF0ZS5ub3coKSB9KTtcbiAgICByZXR1cm4gY291bnQ7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGNvbnNvbGUud2FybignW1dlcENoYXQgQmFja2dyb3VuZF0gRmVobGVyIGJlaW0gQWJydWZlbiBkZXMgT25saW5lLUNvdW50czonLCBlcnIpO1xuICAgIHJldHVybiAwO1xuICB9XG59XG5cbi8qKlxuICogRm9ybWF0aWVydCBkZW4gQmFkZ2UtVGV4dDpcbiAqIDw9IDE6IGxlZXIgKGtlaW4gdmlzdWVsbGVyIEzDpHJtKVxuICogMiAtIDk5OTogZ2VuYXVlIFphaGxcbiAqID49IDEwMDA6IFwiOTkrXCJcbiAqL1xuZnVuY3Rpb24gZm9ybWF0QmFkZ2VUZXh0KGNvdW50OiBudW1iZXIpOiBzdHJpbmcge1xuICBpZiAoY291bnQgPD0gMSkgcmV0dXJuICcnO1xuICBpZiAoY291bnQgPiA5OTkpIHJldHVybiAnOTkrJztcbiAgcmV0dXJuIFN0cmluZyhjb3VudCk7XG59XG5cbi8qKlxuICogQWt0dWFsaXNpZXJ0IGRlbiBCYWRnZSBmw7xyIGVpbmVuIHNwZXppZmlzY2hlbiBUYWJcbiAqL1xuYXN5bmMgZnVuY3Rpb24gdXBkYXRlQmFkZ2VGb3JUYWIodGFiSWQ6IG51bWJlciwgcmF3VXJsPzogc3RyaW5nKSB7XG4gIGlmICghdGFiSWQgfHwgdGFiSWQgPT09IGNocm9tZS50YWJzLlRBQl9JRF9OT05FKSByZXR1cm47XG5cbiAgaWYgKCFyYXdVcmwpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgdGFiID0gYXdhaXQgY2hyb21lLnRhYnMuZ2V0KHRhYklkKTtcbiAgICAgIHJhd1VybCA9IHRhYj8udXJsO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHVybCA9IGNsZWFuVXJsKHJhd1VybCB8fCAnJyk7XG4gIGlmICghdXJsKSB7XG4gICAgY2hyb21lLmFjdGlvbi5zZXRCYWRnZVRleHQoeyB0ZXh0OiAnJywgdGFiSWQgfSkuY2F0Y2goKCkgPT4ge30pO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGNvdW50ID0gYXdhaXQgZmV0Y2hPbmxpbmVDb3VudCh1cmwpO1xuICBjb25zdCBiYWRnZVRleHQgPSBmb3JtYXRCYWRnZVRleHQoY291bnQpO1xuXG4gIHRyeSB7XG4gICAgYXdhaXQgY2hyb21lLmFjdGlvbi5zZXRCYWRnZVRleHQoeyB0ZXh0OiBiYWRnZVRleHQsIHRhYklkIH0pO1xuICAgIGlmIChiYWRnZVRleHQpIHtcbiAgICAgIGF3YWl0IGNocm9tZS5hY3Rpb24uc2V0QmFkZ2VCYWNrZ3JvdW5kQ29sb3IoeyBjb2xvcjogQkFER0VfQ09MT1IsIHRhYklkIH0pO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgLy8gVGFiIGV2ZW50dWVsbCBzY2hvbiBnZXNjaGxvc3NlblxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUJhY2tncm91bmQoKCkgPT4ge1xuICAvLyAxLiDDlmZmbmV0IGRhcyBTaWRlcGFuZWwgYmVpIEtsaWNrIGF1ZiBkYXMgRXh0ZW5zaW9uLUljb25cbiAgaWYgKGNocm9tZS5zaWRlUGFuZWwgJiYgY2hyb21lLnNpZGVQYW5lbC5zZXRQYW5lbEJlaGF2aW9yKSB7XG4gICAgY2hyb21lLnNpZGVQYW5lbFxuICAgICAgLnNldFBhbmVsQmVoYXZpb3IoeyBvcGVuUGFuZWxPbkFjdGlvbkNsaWNrOiB0cnVlIH0pXG4gICAgICAuY2F0Y2goKGVycm9yOiB1bmtub3duKSA9PiBjb25zb2xlLmVycm9yKCdGZWhsZXIgYmVpIHNldFBhbmVsQmVoYXZpb3I6JywgZXJyb3IpKTtcbiAgfVxuXG4gIC8vIEZhbGxiYWNrOiBGYWxscyBzZXRQYW5lbEJlaGF2aW9yIG5pY2h0IHNvZm9ydCBncmVpZnRcbiAgY2hyb21lLmFjdGlvbi5vbkNsaWNrZWQuYWRkTGlzdGVuZXIoYXN5bmMgKHRhYikgPT4ge1xuICAgIGlmICh0YWIud2luZG93SWQgJiYgY2hyb21lLnNpZGVQYW5lbCAmJiBjaHJvbWUuc2lkZVBhbmVsLm9wZW4pIHtcbiAgICAgIGF3YWl0IGNocm9tZS5zaWRlUGFuZWwub3Blbih7IHdpbmRvd0lkOiB0YWIud2luZG93SWQgfSkuY2F0Y2goY29uc29sZS5lcnJvcik7XG4gICAgfVxuICB9KTtcblxuICAvLyAyLiBUYWItV2VjaHNlbDogTnV0emVyIGFrdGl2aWVydCBlaW5lbiBhbmRlcmVuIFRhYlxuICBjaHJvbWUudGFicy5vbkFjdGl2YXRlZC5hZGRMaXN0ZW5lcihhc3luYyAoYWN0aXZlSW5mbykgPT4ge1xuICAgIGF3YWl0IHVwZGF0ZUJhZGdlRm9yVGFiKGFjdGl2ZUluZm8udGFiSWQpO1xuICB9KTtcblxuICAvLyAzLiBUYWItVXBkYXRlOiBVUkwgaGF0IHNpY2ggaW0gVGFiIGdlw6RuZGVydCBvZGVyIFNlaXRlIGlzdCBmZXJ0aWcgZ2VsYWRlblxuICBjaHJvbWUudGFicy5vblVwZGF0ZWQuYWRkTGlzdGVuZXIoYXN5bmMgKHRhYklkLCBjaGFuZ2VJbmZvLCB0YWIpID0+IHtcbiAgICBpZiAoY2hhbmdlSW5mby51cmwgfHwgY2hhbmdlSW5mby5zdGF0dXMgPT09ICdjb21wbGV0ZScpIHtcbiAgICAgIGF3YWl0IHVwZGF0ZUJhZGdlRm9yVGFiKHRhYklkLCB0YWIudXJsKTtcbiAgICB9XG4gIH0pO1xufSk7XG4iLCIvLyAjcmVnaW9uIHNuaXBwZXRcbmV4cG9ydCBjb25zdCBicm93c2VyID0gZ2xvYmFsVGhpcy5icm93c2VyPy5ydW50aW1lPy5pZFxuICA/IGdsb2JhbFRoaXMuYnJvd3NlclxuICA6IGdsb2JhbFRoaXMuY2hyb21lO1xuLy8gI2VuZHJlZ2lvbiBzbmlwcGV0XG4iLCJpbXBvcnQgeyBicm93c2VyIGFzIGJyb3dzZXIkMSB9IGZyb20gXCJAd3h0LWRldi9icm93c2VyXCI7XG4vLyNyZWdpb24gc3JjL2Jyb3dzZXIudHNcbi8qKlxuKiBDb250YWlucyB0aGUgYGJyb3dzZXJgIGV4cG9ydCB3aGljaCB5b3Ugc2hvdWxkIHVzZSB0byBhY2Nlc3MgdGhlIGV4dGVuc2lvblxuKiBBUElzIGluIHlvdXIgcHJvamVjdDpcbipcbiogYGBgdHNcbiogaW1wb3J0IHsgYnJvd3NlciB9IGZyb20gJ3d4dC9icm93c2VyJztcbipcbiogYnJvd3Nlci5ydW50aW1lLm9uSW5zdGFsbGVkLmFkZExpc3RlbmVyKCgpID0+IHtcbiogICAvLyAuLi5cbiogfSk7XG4qIGBgYFxuKlxuKiBAbW9kdWxlIHd4dC9icm93c2VyXG4qL1xuY29uc3QgYnJvd3NlciA9IGJyb3dzZXIkMTtcbi8vI2VuZHJlZ2lvblxuZXhwb3J0IHsgYnJvd3NlciB9O1xuIiwiLy8jcmVnaW9uIHNyYy9pbmRleC50c1xuLyoqXG4qIENsYXNzIGZvciBwYXJzaW5nIGFuZCBwZXJmb3JtaW5nIG9wZXJhdGlvbnMgb24gbWF0Y2ggcGF0dGVybnMuXG4qXG4qIEBleGFtcGxlXG4qICAgY29uc3QgcGF0dGVybiA9IG5ldyBNYXRjaFBhdHRlcm4oJyo6Ly9nb29nbGUuY29tLyonKTtcbipcbiogICBwYXR0ZXJuLmluY2x1ZGVzKCdodHRwczovL2dvb2dsZS5jb20nKTsgLy8gdHJ1ZVxuKiAgIHBhdHRlcm4uaW5jbHVkZXMoJ2h0dHA6Ly95b3V0dWJlLmNvbS93YXRjaD92PTEyMycpOyAvLyBmYWxzZVxuKi9cbnZhciBNYXRjaFBhdHRlcm4gPSBjbGFzcyBNYXRjaFBhdHRlcm4ge1xuXHRzdGF0aWMge1xuXHRcdHRoaXMuUFJPVE9DT0xTID0gW1xuXHRcdFx0XCJodHRwXCIsXG5cdFx0XHRcImh0dHBzXCIsXG5cdFx0XHRcImZpbGVcIixcblx0XHRcdFwiZnRwXCIsXG5cdFx0XHRcInVyblwiLFxuXHRcdFx0XCJ3c1wiLFxuXHRcdFx0XCJ3c3NcIlxuXHRcdF07XG5cdH1cblx0LyoqXG5cdCogUGFyc2UgYSBtYXRjaCBwYXR0ZXJuIHN0cmluZy4gSWYgaXQgaXMgaW52YWxpZCwgdGhlIGNvbnN0cnVjdG9yIHdpbGwgdGhyb3cgYW5cblx0KiBgSW52YWxpZE1hdGNoUGF0dGVybmAgZXJyb3IuXG5cdCpcblx0KiBAcGFyYW0gbWF0Y2hQYXR0ZXJuIFRoZSBtYXRjaCBwYXR0ZXJuIHRvIHBhcnNlLlxuXHQqL1xuXHRjb25zdHJ1Y3RvcihtYXRjaFBhdHRlcm4pIHtcblx0XHRpZiAobWF0Y2hQYXR0ZXJuID09PSBcIjxhbGxfdXJscz5cIikge1xuXHRcdFx0dGhpcy5pc0FsbFVybHMgPSB0cnVlO1xuXHRcdFx0dGhpcy5wcm90b2NvbE1hdGNoZXMgPSBbLi4uTWF0Y2hQYXR0ZXJuLlBST1RPQ09MU107XG5cdFx0XHR0aGlzLmhvc3RuYW1lTWF0Y2ggPSBcIipcIjtcblx0XHRcdHRoaXMucGF0aG5hbWVNYXRjaCA9IFwiKlwiO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRjb25zdCBncm91cHMgPSAvKC4qKTpcXC9cXC8oLio/KShcXC8uKikvLmV4ZWMobWF0Y2hQYXR0ZXJuKTtcblx0XHRcdGlmIChncm91cHMgPT0gbnVsbCkgdGhyb3cgbmV3IEludmFsaWRNYXRjaFBhdHRlcm4obWF0Y2hQYXR0ZXJuLCBcIkluY29ycmVjdCBmb3JtYXRcIik7XG5cdFx0XHRjb25zdCBbXywgcHJvdG9jb2wsIGhvc3RuYW1lLCBwYXRobmFtZV0gPSBncm91cHM7XG5cdFx0XHR2YWxpZGF0ZVByb3RvY29sKG1hdGNoUGF0dGVybiwgcHJvdG9jb2wpO1xuXHRcdFx0dmFsaWRhdGVIb3N0bmFtZShtYXRjaFBhdHRlcm4sIGhvc3RuYW1lKTtcblx0XHRcdHRoaXMucHJvdG9jb2xNYXRjaGVzID0gcHJvdG9jb2wgPT09IFwiKlwiID8gW1wiaHR0cFwiLCBcImh0dHBzXCJdIDogW3Byb3RvY29sXTtcblx0XHRcdHRoaXMuaG9zdG5hbWVNYXRjaCA9IGhvc3RuYW1lO1xuXHRcdFx0dGhpcy5wYXRobmFtZU1hdGNoID0gcGF0aG5hbWU7XG5cdFx0fVxuXHR9XG5cdC8qKiBDaGVjayBpZiBhIFVSTCBpcyBpbmNsdWRlZCBpbiBhIHBhdHRlcm4uICovXG5cdGluY2x1ZGVzKHVybCkge1xuXHRcdGNvbnN0IHUgPSB0eXBlb2YgdXJsID09PSBcInN0cmluZ1wiID8gbmV3IFVSTCh1cmwpIDogdXJsIGluc3RhbmNlb2YgTG9jYXRpb24gPyBuZXcgVVJMKHVybC5ocmVmKSA6IHVybDtcblx0XHRpZiAodGhpcy5pc0FsbFVybHMpIHJldHVybiAhdGhpcy5pc1Vua25vd25Qcm90b2NvbCh1KTtcblx0XHRyZXR1cm4gISF0aGlzLnByb3RvY29sTWF0Y2hlcy5maW5kKChwcm90b2NvbCkgPT4ge1xuXHRcdFx0aWYgKHByb3RvY29sID09PSBcImh0dHBcIikgcmV0dXJuIHRoaXMuaXNIdHRwTWF0Y2godSk7XG5cdFx0XHRpZiAocHJvdG9jb2wgPT09IFwiaHR0cHNcIikgcmV0dXJuIHRoaXMuaXNIdHRwc01hdGNoKHUpO1xuXHRcdFx0aWYgKHByb3RvY29sID09PSBcImZpbGVcIikgcmV0dXJuIHRoaXMuaXNGaWxlTWF0Y2godSk7XG5cdFx0XHRpZiAocHJvdG9jb2wgPT09IFwiZnRwXCIpIHJldHVybiB0aGlzLmlzRnRwTWF0Y2godSk7XG5cdFx0XHRpZiAocHJvdG9jb2wgPT09IFwidXJuXCIpIHJldHVybiB0aGlzLmlzVXJuTWF0Y2godSk7XG5cdFx0fSk7XG5cdH1cblx0aXNIdHRwTWF0Y2godXJsKSB7XG5cdFx0cmV0dXJuIHVybC5wcm90b2NvbCA9PT0gXCJodHRwOlwiICYmIHRoaXMuaXNIb3N0UGF0aE1hdGNoKHVybCk7XG5cdH1cblx0aXNIdHRwc01hdGNoKHVybCkge1xuXHRcdHJldHVybiB1cmwucHJvdG9jb2wgPT09IFwiaHR0cHM6XCIgJiYgdGhpcy5pc0hvc3RQYXRoTWF0Y2godXJsKTtcblx0fVxuXHRpc0hvc3RQYXRoTWF0Y2godXJsKSB7XG5cdFx0aWYgKCF0aGlzLmhvc3RuYW1lTWF0Y2ggfHwgIXRoaXMucGF0aG5hbWVNYXRjaCkgcmV0dXJuIGZhbHNlO1xuXHRcdGNvbnN0IGhvc3RuYW1lTWF0Y2hSZWdleHMgPSBbdGhpcy5jb252ZXJ0UGF0dGVyblRvUmVnZXgodGhpcy5ob3N0bmFtZU1hdGNoKSwgdGhpcy5jb252ZXJ0UGF0dGVyblRvUmVnZXgodGhpcy5ob3N0bmFtZU1hdGNoLnJlcGxhY2UoL15cXCpcXC4vLCBcIlwiKSldO1xuXHRcdGNvbnN0IHBhdGhuYW1lTWF0Y2hSZWdleCA9IHRoaXMuY29udmVydFBhdHRlcm5Ub1JlZ2V4KHRoaXMucGF0aG5hbWVNYXRjaCk7XG5cdFx0cmV0dXJuICEhaG9zdG5hbWVNYXRjaFJlZ2V4cy5maW5kKChyZWdleCkgPT4gcmVnZXgudGVzdCh1cmwuaG9zdG5hbWUpKSAmJiBwYXRobmFtZU1hdGNoUmVnZXgudGVzdCh1cmwucGF0aG5hbWUpO1xuXHR9XG5cdGlzVW5rbm93blByb3RvY29sKHVybCkge1xuXHRcdHJldHVybiAhdGhpcy5wcm90b2NvbE1hdGNoZXMuaW5jbHVkZXModXJsLnByb3RvY29sLnNsaWNlKDAsIC0xKSk7XG5cdH1cblx0aXNQYXRoTWF0Y2godXJsKSB7XG5cdFx0aWYgKCF0aGlzLnBhdGhuYW1lTWF0Y2gpIHJldHVybiBmYWxzZTtcblx0XHRyZXR1cm4gdGhpcy5jb252ZXJ0UGF0dGVyblRvUmVnZXgodGhpcy5wYXRobmFtZU1hdGNoKS50ZXN0KHVybC5wYXRobmFtZSk7XG5cdH1cblx0aXNGaWxlTWF0Y2godXJsKSB7XG5cdFx0cmV0dXJuIHVybC5wcm90b2NvbCA9PT0gXCJmaWxlOlwiICYmIHRoaXMuaXNQYXRoTWF0Y2godXJsKTtcblx0fVxuXHRpc0Z0cE1hdGNoKF91cmwpIHtcblx0XHR0aHJvdyBFcnJvcihcIk5vdCBpbXBsZW1lbnRlZDogZnRwOi8vIHBhdHRlcm4gbWF0Y2hpbmcuIE9wZW4gYSBQUiB0byBhZGQgc3VwcG9ydFwiKTtcblx0fVxuXHRpc1Vybk1hdGNoKF91cmwpIHtcblx0XHR0aHJvdyBFcnJvcihcIk5vdCBpbXBsZW1lbnRlZDogdXJuOi8vIHBhdHRlcm4gbWF0Y2hpbmcuIE9wZW4gYSBQUiB0byBhZGQgc3VwcG9ydFwiKTtcblx0fVxuXHRjb252ZXJ0UGF0dGVyblRvUmVnZXgocGF0dGVybikge1xuXHRcdGNvbnN0IHN0YXJzUmVwbGFjZWQgPSB0aGlzLmVzY2FwZUZvclJlZ2V4KHBhdHRlcm4pLnJlcGxhY2UoL1xcXFxcXCovZywgXCIuKlwiKTtcblx0XHRyZXR1cm4gUmVnRXhwKGBeJHtzdGFyc1JlcGxhY2VkfSRgKTtcblx0fVxuXHRlc2NhcGVGb3JSZWdleChzdHJpbmcpIHtcblx0XHRyZXR1cm4gc3RyaW5nLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCBcIlxcXFwkJlwiKTtcblx0fVxufTtcbnZhciBJbnZhbGlkTWF0Y2hQYXR0ZXJuID0gY2xhc3MgZXh0ZW5kcyBFcnJvciB7XG5cdGNvbnN0cnVjdG9yKG1hdGNoUGF0dGVybiwgcmVhc29uKSB7XG5cdFx0c3VwZXIoYEludmFsaWQgbWF0Y2ggcGF0dGVybiBcIiR7bWF0Y2hQYXR0ZXJufVwiOiAke3JlYXNvbn1gKTtcblx0fVxufTtcbmZ1bmN0aW9uIHZhbGlkYXRlUHJvdG9jb2wobWF0Y2hQYXR0ZXJuLCBwcm90b2NvbCkge1xuXHRpZiAoIU1hdGNoUGF0dGVybi5QUk9UT0NPTFMuaW5jbHVkZXMocHJvdG9jb2wpICYmIHByb3RvY29sICE9PSBcIipcIikgdGhyb3cgbmV3IEludmFsaWRNYXRjaFBhdHRlcm4obWF0Y2hQYXR0ZXJuLCBgJHtwcm90b2NvbH0gbm90IGEgdmFsaWQgcHJvdG9jb2wgKCR7TWF0Y2hQYXR0ZXJuLlBST1RPQ09MUy5qb2luKFwiLCBcIil9KWApO1xufVxuZnVuY3Rpb24gdmFsaWRhdGVIb3N0bmFtZShtYXRjaFBhdHRlcm4sIGhvc3RuYW1lKSB7XG5cdGlmIChob3N0bmFtZS5pbmNsdWRlcyhcIjpcIikpIHRocm93IG5ldyBJbnZhbGlkTWF0Y2hQYXR0ZXJuKG1hdGNoUGF0dGVybiwgYEhvc3RuYW1lIGNhbm5vdCBpbmNsdWRlIGEgcG9ydGApO1xuXHRpZiAoaG9zdG5hbWUuaW5jbHVkZXMoXCIqXCIpICYmIGhvc3RuYW1lLmxlbmd0aCA+IDEgJiYgIWhvc3RuYW1lLnN0YXJ0c1dpdGgoXCIqLlwiKSkgdGhyb3cgbmV3IEludmFsaWRNYXRjaFBhdHRlcm4obWF0Y2hQYXR0ZXJuLCBgSWYgdXNpbmcgYSB3aWxkY2FyZCAoKiksIGl0IG11c3QgZ28gYXQgdGhlIHN0YXJ0IG9mIHRoZSBob3N0bmFtZWApO1xufVxuLy8jZW5kcmVnaW9uXG5leHBvcnQgeyBJbnZhbGlkTWF0Y2hQYXR0ZXJuLCBNYXRjaFBhdHRlcm4gfTtcbiJdLCJpZ25vcmVMaXN0IjpbMCwzLDQsNV0sIm1hcHBpbmdzIjoiOztDQUNBLFNBQVMsaUJBQWlCLEtBQUs7RUFDOUIsSUFBSSxPQUFPLFFBQVEsT0FBTyxRQUFRLFlBQVksT0FBTyxFQUFFLE1BQU0sSUFBSTtFQUNqRSxPQUFPO0NBQ1I7Ozs7OztDQ0FBLElBQU0sa0NBQWtCLElBQUksSUFBSTtFQUM5QjtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7Q0FDRixDQUFDOzs7Ozs7O0NBUUQsU0FBZ0IsU0FBUyxRQUF3QjtFQUMvQyxJQUFJO0dBQ0YsTUFBTSxTQUFTLElBQUksSUFBSSxNQUFNO0dBQzdCLElBQUksQ0FBQyxPQUFPLFNBQVMsV0FBVyxNQUFNLEdBQUcsT0FBTztHQUVoRCxNQUFNLFdBQVcsT0FBTyxTQUFTLFlBQVksQ0FBQyxDQUFDLFFBQVEsVUFBVSxFQUFFO0dBR25FLElBQUksYUFBYSxpQkFBaUIsYUFBYSxpQkFBaUI7SUFDOUQsSUFBSSxPQUFPLGFBQWEsVUFBVTtLQUNoQyxNQUFNLFVBQVUsT0FBTyxhQUFhLElBQUksR0FBRztLQUMzQyxJQUFJLFNBQ0YsT0FBTyxtQ0FBbUM7SUFFOUM7SUFFQSxJQUFJLE9BQU8sU0FBUyxXQUFXLFVBQVUsR0FBRztLQUUxQyxNQUFNLEtBRFEsT0FBTyxTQUFTLE1BQU0sR0FDekIsQ0FBQSxDQUFNO0tBQ2pCLElBQUksSUFDRixPQUFPLG1DQUFtQztJQUU5QztHQUNGLE9BQU8sSUFBSSxhQUFhLFlBQVk7SUFFbEMsTUFBTSxLQUFLLE9BQU8sU0FBUyxRQUFRLE9BQU8sRUFBRSxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQztJQUN6RCxJQUFJ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