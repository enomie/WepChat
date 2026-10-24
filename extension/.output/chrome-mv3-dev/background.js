var background = (function() {
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
				const asin = parsed.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1];
				if (asin) return `https://${hostname}/dp/${asin.toUpperCase()}`;
			}
			if (hostname.includes("google.") && parsed.pathname === "/search") {
				const query = parsed.searchParams.get("q");
				if (query) return `https://${hostname}/search?q=${encodeURIComponent(query)}`;
			}
			if (hostname.includes("reddit.com")) {
				const redditMatch = parsed.pathname.match(/\/r\/([^/]+)\/comments\/([^/]+)/);
				const subreddit = redditMatch?.[1];
				const postId = redditMatch?.[2];
				if (subreddit && postId) return `https://www.reddit.com/r/${subreddit.toLowerCase()}/comments/${postId}/`;
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
		if (!tabId || tabId === browser.tabs.TAB_ID_NONE) return;
		if (!rawUrl) try {
			rawUrl = (await browser.tabs.get(tabId))?.url;
		} catch {
			return;
		}
		const url = cleanUrl(rawUrl || "");
		if (!url) {
			browser.action.setBadgeText({
				text: "",
				tabId
			}).catch(() => {});
			return;
		}
		const badgeText = formatBadgeText(await fetchOnlineCount(url));
		try {
			await browser.action.setBadgeText({
				text: badgeText,
				tabId
			});
			if (badgeText) await browser.action.setBadgeBackgroundColor({
				color: BADGE_COLOR,
				tabId
			});
		} catch {}
	}
	var background_default = defineBackground(() => {
		const sidePanel = chrome.sidePanel;
		if (sidePanel?.setPanelBehavior) sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error("Fehler bei setPanelBehavior:", error));
		browser.action.onClicked.addListener(async (tab) => {
			if (tab.windowId && sidePanel?.open) await sidePanel.open({ windowId: tab.windowId }).catch(console.error);
		});
		browser.tabs.onActivated.addListener(async (activeInfo) => {
			await updateBadgeForTab(activeInfo.tabId);
		});
		browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
			if (changeInfo.url || changeInfo.status === "complete") await updateBadgeForTab(tabId, tab.url);
		});
	});
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

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2dyb3VuZC5qcyIsIm5hbWVzIjpbImJyb3dzZXIiLCJiYWNrZ3JvdW5kX2VudHJ5cG9pbnRfZGVmYXVsdCJdLCJzb3VyY2VzIjpbIi4uLy4uL25vZGVfbW9kdWxlcy9Ad3h0LWRldi9icm93c2VyL3NyYy9pbmRleC5tanMiLCIuLi8uLi9ub2RlX21vZHVsZXMvd3h0L2Rpc3QvYnJvd3Nlci5tanMiLCIuLi8uLi9ub2RlX21vZHVsZXMvd3h0L2Rpc3QvdXRpbHMvZGVmaW5lLWJhY2tncm91bmQubWpzIiwiLi4vLi4vc3JjL2xpYi91cmwtdXRpbHMudHMiLCIuLi8uLi9zcmMvZW50cnlwb2ludHMvYmFja2dyb3VuZC50cyIsIi4uLy4uL25vZGVfbW9kdWxlcy9Ad2ViZXh0LWNvcmUvbWF0Y2gtcGF0dGVybnMvZGlzdC9pbmRleC5tanMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gI3JlZ2lvbiBzbmlwcGV0XG5leHBvcnQgY29uc3QgYnJvd3NlciA9IGdsb2JhbFRoaXMuYnJvd3Nlcj8ucnVudGltZT8uaWRcbiAgPyBnbG9iYWxUaGlzLmJyb3dzZXJcbiAgOiBnbG9iYWxUaGlzLmNocm9tZTtcbi8vICNlbmRyZWdpb24gc25pcHBldFxuIiwiaW1wb3J0IHsgYnJvd3NlciBhcyBicm93c2VyJDEgfSBmcm9tIFwiQHd4dC1kZXYvYnJvd3NlclwiO1xuLy8jcmVnaW9uIHNyYy9icm93c2VyLnRzXG4vKipcbiogQ29udGFpbnMgdGhlIGBicm93c2VyYCBleHBvcnQgd2hpY2ggeW91IHNob3VsZCB1c2UgdG8gYWNjZXNzIHRoZSBleHRlbnNpb25cbiogQVBJcyBpbiB5b3VyIHByb2plY3Q6XG4qXG4qIGBgYHRzXG4qIGltcG9ydCB7IGJyb3dzZXIgfSBmcm9tICd3eHQvYnJvd3Nlcic7XG4qXG4qIGJyb3dzZXIucnVudGltZS5vbkluc3RhbGxlZC5hZGRMaXN0ZW5lcigoKSA9PiB7XG4qICAgLy8gLi4uXG4qIH0pO1xuKiBgYGBcbipcbiogQG1vZHVsZSB3eHQvYnJvd3NlclxuKi9cbmNvbnN0IGJyb3dzZXIgPSBicm93c2VyJDE7XG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IGJyb3dzZXIgfTtcbiIsIi8vI3JlZ2lvbiBzcmMvdXRpbHMvZGVmaW5lLWJhY2tncm91bmQudHNcbmZ1bmN0aW9uIGRlZmluZUJhY2tncm91bmQoYXJnKSB7XG5cdGlmIChhcmcgPT0gbnVsbCB8fCB0eXBlb2YgYXJnID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiB7IG1haW46IGFyZyB9O1xuXHRyZXR1cm4gYXJnO1xufVxuLy8jZW5kcmVnaW9uXG5leHBvcnQgeyBkZWZpbmVCYWNrZ3JvdW5kIH07XG4iLCIvKipcbiAqIExpc3RlIGJla2FubnRlciBUcmFja2luZy0gdW5kIFNlc3Npb24tUGFyYW1ldGVyLCBkaWUgbmllbWFsc1xuICogaWRlbnRpdMOkdHNzdGlmdGVuZCBmw7xyIGRlbiBJbmhhbHQgZWluZXIgU2VpdGUgc2luZC5cbiAqL1xuY29uc3QgVFJBQ0tJTkdfUEFSQU1TID0gbmV3IFNldChbXG4gICd1dG1fc291cmNlJyxcbiAgJ3V0bV9tZWRpdW0nLFxuICAndXRtX2NhbXBhaWduJyxcbiAgJ3V0bV90ZXJtJyxcbiAgJ3V0bV9jb250ZW50JyxcbiAgJ3JlZicsXG4gICdyZWZfJyxcbiAgJ2ZiY2xpZCcsXG4gICdnY2xpZCcsXG4gICdnY2xzcmMnLFxuICAnZGNsaWQnLFxuICAnbXNjbGtpZCcsXG4gICdtY19laWQnLFxuICAnemFucGlkJyxcbiAgJ2lnc2hpZCcsXG4gICdzaScsIC8vIFNwb3RpZnkgLyBZb3VUdWJlIHNoYXJlIHRyYWNrZXJcbiAgJ2ZlYXR1cmUnLCAvLyBZb3VUdWJlIHNoYXJlIHRyYWNrZXJcbiAgJ3NwbV9pZF9mcm9tJywgLy8gQmlsaWJpbGkgdHJhY2tlclxuICAnZnJvbV9zb3VyY2UnLFxuICAnc2Vzc2lvbl9pZCcsXG4gICdzZXNzaW9uSWQnLFxuXSk7XG5cbi8qKlxuICogTm9ybWFsaXNpZXJ0IGVpbmUgV2ViLVVSTCBzZW1hbnRpc2NoOlxuICogMS4gUGxhdHRmb3JtLUF1c25haG1lbiAoWW91VHViZSwgQW1hem9uLCBldGMuKSwgYmVpIGRlbmVuIFBhcmFtZXRlciBkZW4gSW5oYWx0IGJlc3RpbW1lblxuICogMi4gQmVyZWluaWd1bmcgdm9uIFRyYWNraW5nLSB1bmQgU2Vzc2lvbi1QYXJhbWV0ZXJuXG4gKiAzLiBFbnRmZXJudW5nIHZvbiBVUkwtSGFzaGVzICgjYW5jaG9ycylcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFuVXJsKHJhd1VybDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBuZXcgVVJMKHJhd1VybCk7XG4gICAgaWYgKCFwYXJzZWQucHJvdG9jb2wuc3RhcnRzV2l0aCgnaHR0cCcpKSByZXR1cm4gJyc7XG5cbiAgICBjb25zdCBob3N0bmFtZSA9IHBhcnNlZC5ob3N0bmFtZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL153d3dcXC4vLCAnJyk7XG5cbiAgICAvLyAxLiBZb3VUdWJlXG4gICAgaWYgKGhvc3RuYW1lID09PSAneW91dHViZS5jb20nIHx8IGhvc3RuYW1lID09PSAnbS55b3V0dWJlLmNvbScpIHtcbiAgICAgIGlmIChwYXJzZWQucGF0aG5hbWUgPT09ICcvd2F0Y2gnKSB7XG4gICAgICAgIGNvbnN0IHZpZGVvSWQgPSBwYXJzZWQuc2VhcmNoUGFyYW1zLmdldCgndicpO1xuICAgICAgICBpZiAodmlkZW9JZCkge1xuICAgICAgICAgIHJldHVybiBgaHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g/dj0ke3ZpZGVvSWR9YDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gWW91VHViZSBTaG9ydHM6IGh0dHBzOi8vd3d3LnlvdXR1YmUuY29tL3Nob3J0cy97aWR9XG4gICAgICBpZiAocGFyc2VkLnBhdGhuYW1lLnN0YXJ0c1dpdGgoJy9zaG9ydHMvJykpIHtcbiAgICAgICAgY29uc3QgcGFydHMgPSBwYXJzZWQucGF0aG5hbWUuc3BsaXQoJy8nKTtcbiAgICAgICAgY29uc3QgaWQgPSBwYXJ0c1syXTtcbiAgICAgICAgaWYgKGlkKSB7XG4gICAgICAgICAgcmV0dXJuIGBodHRwczovL3d3dy55b3V0dWJlLmNvbS93YXRjaD92PSR7aWR9YDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoaG9zdG5hbWUgPT09ICd5b3V0dS5iZScpIHtcbiAgICAgIC8vIHlvdXR1LmJlL0lEIFNob3J0bGlua1xuICAgICAgY29uc3QgaWQgPSBwYXJzZWQucGF0aG5hbWUucmVwbGFjZSgvXlxcLy8sICcnKS5zcGxpdCgnLycpWzBdO1xuICAgICAgaWYgKGlkKSB7XG4gICAgICAgIHJldHVybiBgaHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g/dj0ke2lkfWA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gMi4gQW1hem9uIChhbWF6b24uZGUsIGFtYXpvbi5jb20sIGV0Yy4pXG4gICAgaWYgKGhvc3RuYW1lLmluY2x1ZGVzKCdhbWF6b24uJykpIHtcbiAgICAgIGNvbnN0IGFzaW5NYXRjaCA9IHBhcnNlZC5wYXRobmFtZS5tYXRjaCgvXFwvKD86ZHB8Z3BcXC9wcm9kdWN0KVxcLyhbQS1aMC05XXsxMH0pL2kpO1xuICAgICAgY29uc3QgYXNpbiA9IGFzaW5NYXRjaD8uWzFdO1xuICAgICAgaWYgKGFzaW4pIHtcbiAgICAgICAgcmV0dXJuIGBodHRwczovLyR7aG9zdG5hbWV9L2RwLyR7YXNpbi50b1VwcGVyQ2FzZSgpfWA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gMy4gR29vZ2xlIFN1Y2hlXG4gICAgaWYgKGhvc3RuYW1lLmluY2x1ZGVzKCdnb29nbGUuJykgJiYgcGFyc2VkLnBhdGhuYW1lID09PSAnL3NlYXJjaCcpIHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gcGFyc2VkLnNlYXJjaFBhcmFtcy5nZXQoJ3EnKTtcbiAgICAgIGlmIChxdWVyeSkge1xuICAgICAgICByZXR1cm4gYGh0dHBzOi8vJHtob3N0bmFtZX0vc2VhcmNoP3E9JHtlbmNvZGVVUklDb21wb25lbnQocXVlcnkpfWA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gNC4gUmVkZGl0XG4gICAgaWYgKGhvc3RuYW1lLmluY2x1ZGVzKCdyZWRkaXQuY29tJykpIHtcbiAgICAgIGNvbnN0IHJlZGRpdE1hdGNoID0gcGFyc2VkLnBhdGhuYW1lLm1hdGNoKC9cXC9yXFwvKFteL10rKVxcL2NvbW1lbnRzXFwvKFteL10rKS8pO1xuICAgICAgY29uc3Qgc3VicmVkZGl0ID0gcmVkZGl0TWF0Y2g/LlsxXTtcbiAgICAgIGNvbnN0IHBvc3RJZCA9IHJlZGRpdE1hdGNoPy5bMl07XG4gICAgICBpZiAoc3VicmVkZGl0ICYmIHBvc3RJZCkge1xuICAgICAgICByZXR1cm4gYGh0dHBzOi8vd3d3LnJlZGRpdC5jb20vci8ke3N1YnJlZGRpdC50b0xvd2VyQ2FzZSgpfS9jb21tZW50cy8ke3Bvc3RJZH0vYDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyA1LiBHZW5lcmlzY2hlciBTdGFuZGFyZC1QZmFkOlxuICAgIC8vIFRyYWNraW5nLVBhcmFtZXRlciBlbnRmZXJuZW4sIGFsbGUgYW5kZXJlbiAoei4gQi4gP2lkPTEyMywgP3BhZ2U9Mikgc29ydGllcnQgYmVoYWx0ZW5cbiAgICBjb25zdCBzZWFyY2hQYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKCk7XG4gICAgcGFyc2VkLnNlYXJjaFBhcmFtcy5mb3JFYWNoKCh2YWwsIGtleSkgPT4ge1xuICAgICAgY29uc3QgbG93ZXJLZXkgPSBrZXkudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmICghVFJBQ0tJTkdfUEFSQU1TLmhhcyhsb3dlcktleSkgJiYgIWxvd2VyS2V5LnN0YXJ0c1dpdGgoJ3V0bV8nKSkge1xuICAgICAgICBzZWFyY2hQYXJhbXMuYXBwZW5kKGtleSwgdmFsKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHNlYXJjaFBhcmFtcy5zb3J0KCk7XG4gICAgY29uc3QgcXVlcnkgPSBzZWFyY2hQYXJhbXMudG9TdHJpbmcoKTtcblxuICAgIC8vIFRyYWlsaW5nIFNsYXNoIGVudGZlcm5lbiAoYXXDn2VyIGJlaSBSb290IFwiL1wiKVxuICAgIGxldCBwYXRobmFtZSA9IHBhcnNlZC5wYXRobmFtZTtcbiAgICBpZiAocGF0aG5hbWUubGVuZ3RoID4gMSAmJiBwYXRobmFtZS5lbmRzV2l0aCgnLycpKSB7XG4gICAgICBwYXRobmFtZSA9IHBhdGhuYW1lLnNsaWNlKDAsIC0xKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYCR7cGFyc2VkLm9yaWdpbn0ke3BhdGhuYW1lfSR7cXVlcnkgPyBgPyR7cXVlcnl9YCA6ICcnfWA7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnJztcbiAgfVxufVxuIiwiaW1wb3J0IHsgY2xlYW5VcmwgfSBmcm9tICdAL2xpYi91cmwtdXRpbHMnO1xuXG5jb25zdCBTUEFDRVRJTUVEQl9TUUxfVVJMID0gJ2h0dHBzOi8vbWFpbmNsb3VkLnNwYWNldGltZWRiLmNvbS92MS9kYXRhYmFzZS93ZXBjaGF0L3NxbCc7XG5jb25zdCBCQURHRV9DT0xPUiA9ICcjMjU2M0VCJzsgLy8gV2VwQ2hhdCBCbGF1XG5cbi8vIEt1cnplciBJbi1NZW1vcnkgQ2FjaGUgcHJvIFVSTCAoMTBzKSwgdW0gcmVkdW5kYW50ZSBSZXF1ZXN0cyBiZWltIHNjaG5lbGxlbiBIaW4tIHVuZCBIZXJ3ZWNoc2VsbiB6dSBtaW5pbWllcmVuXG5jb25zdCBjb3VudENhY2hlID0gbmV3IE1hcDxzdHJpbmcsIHsgY291bnQ6IG51bWJlcjsgdGltZXN0YW1wOiBudW1iZXIgfT4oKTtcbmNvbnN0IENBQ0hFX1RUTF9NUyA9IDEwXzAwMDtcblxuLyoqXG4gKiBGcmFndCBkaWUgU3BhY2V0aW1lREIgcGVyIGxlaWNodGVtIEhUVFAtU1FMLUVuZHBvaW50IGFiXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZldGNoT25saW5lQ291bnQodXJsOiBzdHJpbmcpOiBQcm9taXNlPG51bWJlcj4ge1xuICBjb25zdCBjYWNoZWQgPSBjb3VudENhY2hlLmdldCh1cmwpO1xuICBpZiAoY2FjaGVkICYmIERhdGUubm93KCkgLSBjYWNoZWQudGltZXN0YW1wIDwgQ0FDSEVfVFRMX01TKSB7XG4gICAgcmV0dXJuIGNhY2hlZC5jb3VudDtcbiAgfVxuXG4gIC8vIEVzY2FwZSBlaW5mYWNoZXMgQW5mw7xocnVuZ3N6ZWljaGVuIGbDvHIgU1FMXG4gIGNvbnN0IGVzY2FwZWRVcmwgPSB1cmwucmVwbGFjZSgvJy9nLCBcIicnXCIpO1xuICBjb25zdCBxdWVyeSA9IGBTRUxFQ1QgY291bnQoKikgYXMgdG90YWwgRlJPTSB1c2VyX3Nlc3Npb24gV0hFUkUgY3VycmVudF91cmwgPSAnJHtlc2NhcGVkVXJsfSdgO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChTUEFDRVRJTUVEQl9TUUxfVVJMLCB7XG4gICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6ICd0ZXh0L3BsYWluJyB9LFxuICAgICAgYm9keTogcXVlcnksXG4gICAgfSk7XG5cbiAgICBpZiAoIXJlc3BvbnNlLm9rKSByZXR1cm4gMDtcbiAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVzcG9uc2UuanNvbigpO1xuICAgIGNvbnN0IGNvdW50ID0gTnVtYmVyKGRhdGE/LlswXT8ucm93cz8uWzBdPy5bMF0gPz8gMCk7XG5cbiAgICBjb3VudENhY2hlLnNldCh1cmwsIHsgY291bnQsIHRpbWVzdGFtcDogRGF0ZS5ub3coKSB9KTtcbiAgICByZXR1cm4gY291bnQ7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGNvbnNvbGUud2FybignW1dlcENoYXQgQmFja2dyb3VuZF0gRmVobGVyIGJlaW0gQWJydWZlbiBkZXMgT25saW5lLUNvdW50czonLCBlcnIpO1xuICAgIHJldHVybiAwO1xuICB9XG59XG5cbi8qKlxuICogRm9ybWF0aWVydCBkZW4gQmFkZ2UtVGV4dDpcbiAqIDw9IDE6IGxlZXIgKGtlaW4gdmlzdWVsbGVyIEzDpHJtKVxuICogMiAtIDk5OTogZ2VuYXVlIFphaGxcbiAqID49IDEwMDA6IFwiOTkrXCJcbiAqL1xuZnVuY3Rpb24gZm9ybWF0QmFkZ2VUZXh0KGNvdW50OiBudW1iZXIpOiBzdHJpbmcge1xuICBpZiAoY291bnQgPD0gMSkgcmV0dXJuICcnO1xuICBpZiAoY291bnQgPiA5OTkpIHJldHVybiAnOTkrJztcbiAgcmV0dXJuIFN0cmluZyhjb3VudCk7XG59XG5cbi8qKlxuICogQWt0dWFsaXNpZXJ0IGRlbiBCYWRnZSBmw7xyIGVpbmVuIHNwZXppZmlzY2hlbiBUYWJcbiAqL1xuYXN5bmMgZnVuY3Rpb24gdXBkYXRlQmFkZ2VGb3JUYWIodGFiSWQ6IG51bWJlciwgcmF3VXJsPzogc3RyaW5nKSB7XG4gIGlmICghdGFiSWQgfHwgdGFiSWQgPT09IGJyb3dzZXIudGFicy5UQUJfSURfTk9ORSkgcmV0dXJuO1xuXG4gIGlmICghcmF3VXJsKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHRhYiA9IGF3YWl0IGJyb3dzZXIudGFicy5nZXQodGFiSWQpO1xuICAgICAgcmF3VXJsID0gdGFiPy51cmw7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICB9XG5cbiAgY29uc3QgdXJsID0gY2xlYW5VcmwocmF3VXJsIHx8ICcnKTtcbiAgaWYgKCF1cmwpIHtcbiAgICBicm93c2VyLmFjdGlvbi5zZXRCYWRnZVRleHQoeyB0ZXh0OiAnJywgdGFiSWQgfSkuY2F0Y2goKCkgPT4ge30pO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGNvdW50ID0gYXdhaXQgZmV0Y2hPbmxpbmVDb3VudCh1cmwpO1xuICBjb25zdCBiYWRnZVRleHQgPSBmb3JtYXRCYWRnZVRleHQoY291bnQpO1xuXG4gIHRyeSB7XG4gICAgYXdhaXQgYnJvd3Nlci5hY3Rpb24uc2V0QmFkZ2VUZXh0KHsgdGV4dDogYmFkZ2VUZXh0LCB0YWJJZCB9KTtcbiAgICBpZiAoYmFkZ2VUZXh0KSB7XG4gICAgICBhd2FpdCBicm93c2VyLmFjdGlvbi5zZXRCYWRnZUJhY2tncm91bmRDb2xvcih7IGNvbG9yOiBCQURHRV9DT0xPUiwgdGFiSWQgfSk7XG4gICAgfVxuICB9IGNhdGNoIHtcbiAgICAvLyBUYWIgZXZlbnR1ZWxsIHNjaG9uIGdlc2NobG9zc2VuXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQmFja2dyb3VuZCgoKSA9PiB7XG4gIC8vIENocm9tZS1vbmx5OiBTaWRlIFBhbmVsIChGaXJlZm94IG51dHp0IHNpZGViYXJfYWN0aW9uIGltIE1hbmlmZXN0KVxuICBjb25zdCBzaWRlUGFuZWwgPSBjaHJvbWUuc2lkZVBhbmVsO1xuICBpZiAoc2lkZVBhbmVsPy5zZXRQYW5lbEJlaGF2aW9yKSB7XG4gICAgc2lkZVBhbmVsXG4gICAgICAuc2V0UGFuZWxCZWhhdmlvcih7IG9wZW5QYW5lbE9uQWN0aW9uQ2xpY2s6IHRydWUgfSlcbiAgICAgIC5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IGNvbnNvbGUuZXJyb3IoJ0ZlaGxlciBiZWkgc2V0UGFuZWxCZWhhdmlvcjonLCBlcnJvcikpO1xuICB9XG5cbiAgLy8gRmFsbGJhY2s6IEZhbGxzIHNldFBhbmVsQmVoYXZpb3IgbmljaHQgc29mb3J0IGdyZWlmdFxuICBicm93c2VyLmFjdGlvbi5vbkNsaWNrZWQuYWRkTGlzdGVuZXIoYXN5bmMgKHRhYikgPT4ge1xuICAgIGlmICh0YWIud2luZG93SWQgJiYgc2lkZVBhbmVsPy5vcGVuKSB7XG4gICAgICBhd2FpdCBzaWRlUGFuZWwub3Blbih7IHdpbmRvd0lkOiB0YWIud2luZG93SWQgfSkuY2F0Y2goY29uc29sZS5lcnJvcik7XG4gICAgfVxuICB9KTtcblxuICBicm93c2VyLnRhYnMub25BY3RpdmF0ZWQuYWRkTGlzdGVuZXIoYXN5bmMgKGFjdGl2ZUluZm8pID0+IHtcbiAgICBhd2FpdCB1cGRhdGVCYWRnZUZvclRhYihhY3RpdmVJbmZvLnRhYklkKTtcbiAgfSk7XG5cbiAgYnJvd3Nlci50YWJzLm9uVXBkYXRlZC5hZGRMaXN0ZW5lcihhc3luYyAodGFiSWQsIGNoYW5nZUluZm8sIHRhYikgPT4ge1xuICAgIGlmIChjaGFuZ2VJbmZvLnVybCB8fCBjaGFuZ2VJbmZvLnN0YXR1cyA9PT0gJ2NvbXBsZXRlJykge1xuICAgICAgYXdhaXQgdXBkYXRlQmFkZ2VGb3JUYWIodGFiSWQsIHRhYi51cmwpO1xuICAgIH1cbiAgfSk7XG59KTtcbiIsIi8vI3JlZ2lvbiBzcmMvaW5kZXgudHNcbi8qKlxuKiBDbGFzcyBmb3IgcGFyc2luZyBhbmQgcGVyZm9ybWluZyBvcGVyYXRpb25zIG9uIG1hdGNoIHBhdHRlcm5zLlxuKlxuKiBAZXhhbXBsZVxuKiAgIGNvbnN0IHBhdHRlcm4gPSBuZXcgTWF0Y2hQYXR0ZXJuKCcqOi8vZ29vZ2xlLmNvbS8qJyk7XG4qXG4qICAgcGF0dGVybi5pbmNsdWRlcygnaHR0cHM6Ly9nb29nbGUuY29tJyk7IC8vIHRydWVcbiogICBwYXR0ZXJuLmluY2x1ZGVzKCdodHRwOi8veW91dHViZS5jb20vd2F0Y2g/dj0xMjMnKTsgLy8gZmFsc2VcbiovXG52YXIgTWF0Y2hQYXR0ZXJuID0gY2xhc3MgTWF0Y2hQYXR0ZXJuIHtcblx0c3RhdGljIHtcblx0XHR0aGlzLlBST1RPQ09MUyA9IFtcblx0XHRcdFwiaHR0cFwiLFxuXHRcdFx0XCJodHRwc1wiLFxuXHRcdFx0XCJmaWxlXCIsXG5cdFx0XHRcImZ0cFwiLFxuXHRcdFx0XCJ1cm5cIixcblx0XHRcdFwid3NcIixcblx0XHRcdFwid3NzXCJcblx0XHRdO1xuXHR9XG5cdC8qKlxuXHQqIFBhcnNlIGEgbWF0Y2ggcGF0dGVybiBzdHJpbmcuIElmIGl0IGlzIGludmFsaWQsIHRoZSBjb25zdHJ1Y3RvciB3aWxsIHRocm93IGFuXG5cdCogYEludmFsaWRNYXRjaFBhdHRlcm5gIGVycm9yLlxuXHQqXG5cdCogQHBhcmFtIG1hdGNoUGF0dGVybiBUaGUgbWF0Y2ggcGF0dGVybiB0byBwYXJzZS5cblx0Ki9cblx0Y29uc3RydWN0b3IobWF0Y2hQYXR0ZXJuKSB7XG5cdFx0aWYgKG1hdGNoUGF0dGVybiA9PT0gXCI8YWxsX3VybHM+XCIpIHtcblx0XHRcdHRoaXMuaXNBbGxVcmxzID0gdHJ1ZTtcblx0XHRcdHRoaXMucHJvdG9jb2xNYXRjaGVzID0gWy4uLk1hdGNoUGF0dGVybi5QUk9UT0NPTFNdO1xuXHRcdFx0dGhpcy5ob3N0bmFtZU1hdGNoID0gXCIqXCI7XG5cdFx0XHR0aGlzLnBhdGhuYW1lTWF0Y2ggPSBcIipcIjtcblx0XHR9IGVsc2Uge1xuXHRcdFx0Y29uc3QgZ3JvdXBzID0gLyguKik6XFwvXFwvKC4qPykoXFwvLiopLy5leGVjKG1hdGNoUGF0dGVybik7XG5cdFx0XHRpZiAoZ3JvdXBzID09IG51bGwpIHRocm93IG5ldyBJbnZhbGlkTWF0Y2hQYXR0ZXJuKG1hdGNoUGF0dGVybiwgXCJJbmNvcnJlY3QgZm9ybWF0XCIpO1xuXHRcdFx0Y29uc3QgW18sIHByb3RvY29sLCBob3N0bmFtZSwgcGF0aG5hbWVdID0gZ3JvdXBzO1xuXHRcdFx0dmFsaWRhdGVQcm90b2NvbChtYXRjaFBhdHRlcm4sIHByb3RvY29sKTtcblx0XHRcdHZhbGlkYXRlSG9zdG5hbWUobWF0Y2hQYXR0ZXJuLCBob3N0bmFtZSk7XG5cdFx0XHR0aGlzLnByb3RvY29sTWF0Y2hlcyA9IHByb3RvY29sID09PSBcIipcIiA/IFtcImh0dHBcIiwgXCJodHRwc1wiXSA6IFtwcm90b2NvbF07XG5cdFx0XHR0aGlzLmhvc3RuYW1lTWF0Y2ggPSBob3N0bmFtZTtcblx0XHRcdHRoaXMucGF0aG5hbWVNYXRjaCA9IHBhdGhuYW1lO1xuXHRcdH1cblx0fVxuXHQvKiogQ2hlY2sgaWYgYSBVUkwgaXMgaW5jbHVkZWQgaW4gYSBwYXR0ZXJuLiAqL1xuXHRpbmNsdWRlcyh1cmwpIHtcblx0XHRjb25zdCB1ID0gdHlwZW9mIHVybCA9PT0gXCJzdHJpbmdcIiA/IG5ldyBVUkwodXJsKSA6IHVybCBpbnN0YW5jZW9mIExvY2F0aW9uID8gbmV3IFVSTCh1cmwuaHJlZikgOiB1cmw7XG5cdFx0aWYgKHRoaXMuaXNBbGxVcmxzKSByZXR1cm4gIXRoaXMuaXNVbmtub3duUHJvdG9jb2wodSk7XG5cdFx0cmV0dXJuICEhdGhpcy5wcm90b2NvbE1hdGNoZXMuZmluZCgocHJvdG9jb2wpID0+IHtcblx0XHRcdGlmIChwcm90b2NvbCA9PT0gXCJodHRwXCIpIHJldHVybiB0aGlzLmlzSHR0cE1hdGNoKHUpO1xuXHRcdFx0aWYgKHByb3RvY29sID09PSBcImh0dHBzXCIpIHJldHVybiB0aGlzLmlzSHR0cHNNYXRjaCh1KTtcblx0XHRcdGlmIChwcm90b2NvbCA9PT0gXCJmaWxlXCIpIHJldHVybiB0aGlzLmlzRmlsZU1hdGNoKHUpO1xuXHRcdFx0aWYgKHByb3RvY29sID09PSBcImZ0cFwiKSByZXR1cm4gdGhpcy5pc0Z0cE1hdGNoKHUpO1xuXHRcdFx0aWYgKHByb3RvY29sID09PSBcInVyblwiKSByZXR1cm4gdGhpcy5pc1Vybk1hdGNoKHUpO1xuXHRcdH0pO1xuXHR9XG5cdGlzSHR0cE1hdGNoKHVybCkge1xuXHRcdHJldHVybiB1cmwucHJvdG9jb2wgPT09IFwiaHR0cDpcIiAmJiB0aGlzLmlzSG9zdFBhdGhNYXRjaCh1cmwpO1xuXHR9XG5cdGlzSHR0cHNNYXRjaCh1cmwpIHtcblx0XHRyZXR1cm4gdXJsLnByb3RvY29sID09PSBcImh0dHBzOlwiICYmIHRoaXMuaXNIb3N0UGF0aE1hdGNoKHVybCk7XG5cdH1cblx0aXNIb3N0UGF0aE1hdGNoKHVybCkge1xuXHRcdGlmICghdGhpcy5ob3N0bmFtZU1hdGNoIHx8ICF0aGlzLnBhdGhuYW1lTWF0Y2gpIHJldHVybiBmYWxzZTtcblx0XHRjb25zdCBob3N0bmFtZU1hdGNoUmVnZXhzID0gW3RoaXMuY29udmVydFBhdHRlcm5Ub1JlZ2V4KHRoaXMuaG9zdG5hbWVNYXRjaCksIHRoaXMuY29udmVydFBhdHRlcm5Ub1JlZ2V4KHRoaXMuaG9zdG5hbWVNYXRjaC5yZXBsYWNlKC9eXFwqXFwuLywgXCJcIikpXTtcblx0XHRjb25zdCBwYXRobmFtZU1hdGNoUmVnZXggPSB0aGlzLmNvbnZlcnRQYXR0ZXJuVG9SZWdleCh0aGlzLnBhdGhuYW1lTWF0Y2gpO1xuXHRcdHJldHVybiAhIWhvc3RuYW1lTWF0Y2hSZWdleHMuZmluZCgocmVnZXgpID0+IHJlZ2V4LnRlc3QodXJsLmhvc3RuYW1lKSkgJiYgcGF0aG5hbWVNYXRjaFJlZ2V4LnRlc3QodXJsLnBhdGhuYW1lKTtcblx0fVxuXHRpc1Vua25vd25Qcm90b2NvbCh1cmwpIHtcblx0XHRyZXR1cm4gIXRoaXMucHJvdG9jb2xNYXRjaGVzLmluY2x1ZGVzKHVybC5wcm90b2NvbC5zbGljZSgwLCAtMSkpO1xuXHR9XG5cdGlzUGF0aE1hdGNoKHVybCkge1xuXHRcdGlmICghdGhpcy5wYXRobmFtZU1hdGNoKSByZXR1cm4gZmFsc2U7XG5cdFx0cmV0dXJuIHRoaXMuY29udmVydFBhdHRlcm5Ub1JlZ2V4KHRoaXMucGF0aG5hbWVNYXRjaCkudGVzdCh1cmwucGF0aG5hbWUpO1xuXHR9XG5cdGlzRmlsZU1hdGNoKHVybCkge1xuXHRcdHJldHVybiB1cmwucHJvdG9jb2wgPT09IFwiZmlsZTpcIiAmJiB0aGlzLmlzUGF0aE1hdGNoKHVybCk7XG5cdH1cblx0aXNGdHBNYXRjaChfdXJsKSB7XG5cdFx0dGhyb3cgRXJyb3IoXCJOb3QgaW1wbGVtZW50ZWQ6IGZ0cDovLyBwYXR0ZXJuIG1hdGNoaW5nLiBPcGVuIGEgUFIgdG8gYWRkIHN1cHBvcnRcIik7XG5cdH1cblx0aXNVcm5NYXRjaChfdXJsKSB7XG5cdFx0dGhyb3cgRXJyb3IoXCJOb3QgaW1wbGVtZW50ZWQ6IHVybjovLyBwYXR0ZXJuIG1hdGNoaW5nLiBPcGVuIGEgUFIgdG8gYWRkIHN1cHBvcnRcIik7XG5cdH1cblx0Y29udmVydFBhdHRlcm5Ub1JlZ2V4KHBhdHRlcm4pIHtcblx0XHRjb25zdCBzdGFyc1JlcGxhY2VkID0gdGhpcy5lc2NhcGVGb3JSZWdleChwYXR0ZXJuKS5yZXBsYWNlKC9cXFxcXFwqL2csIFwiLipcIik7XG5cdFx0cmV0dXJuIFJlZ0V4cChgXiR7c3RhcnNSZXBsYWNlZH0kYCk7XG5cdH1cblx0ZXNjYXBlRm9yUmVnZXgoc3RyaW5nKSB7XG5cdFx0cmV0dXJuIHN0cmluZy5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgXCJcXFxcJCZcIik7XG5cdH1cbn07XG52YXIgSW52YWxpZE1hdGNoUGF0dGVybiA9IGNsYXNzIGV4dGVuZHMgRXJyb3Ige1xuXHRjb25zdHJ1Y3RvcihtYXRjaFBhdHRlcm4sIHJlYXNvbikge1xuXHRcdHN1cGVyKGBJbnZhbGlkIG1hdGNoIHBhdHRlcm4gXCIke21hdGNoUGF0dGVybn1cIjogJHtyZWFzb259YCk7XG5cdH1cbn07XG5mdW5jdGlvbiB2YWxpZGF0ZVByb3RvY29sKG1hdGNoUGF0dGVybiwgcHJvdG9jb2wpIHtcblx0aWYgKCFNYXRjaFBhdHRlcm4uUFJPVE9DT0xTLmluY2x1ZGVzKHByb3RvY29sKSAmJiBwcm90b2NvbCAhPT0gXCIqXCIpIHRocm93IG5ldyBJbnZhbGlkTWF0Y2hQYXR0ZXJuKG1hdGNoUGF0dGVybiwgYCR7cHJvdG9jb2x9IG5vdCBhIHZhbGlkIHByb3RvY29sICgke01hdGNoUGF0dGVybi5QUk9UT0NPTFMuam9pbihcIiwgXCIpfSlgKTtcbn1cbmZ1bmN0aW9uIHZhbGlkYXRlSG9zdG5hbWUobWF0Y2hQYXR0ZXJuLCBob3N0bmFtZSkge1xuXHRpZiAoaG9zdG5hbWUuaW5jbHVkZXMoXCI6XCIpKSB0aHJvdyBuZXcgSW52YWxpZE1hdGNoUGF0dGVybihtYXRjaFBhdHRlcm4sIGBIb3N0bmFtZSBjYW5ub3QgaW5jbHVkZSBhIHBvcnRgKTtcblx0aWYgKGhvc3RuYW1lLmluY2x1ZGVzKFwiKlwiKSAmJiBob3N0bmFtZS5sZW5ndGggPiAxICYmICFob3N0bmFtZS5zdGFydHNXaXRoKFwiKi5cIikpIHRocm93IG5ldyBJbnZhbGlkTWF0Y2hQYXR0ZXJuKG1hdGNoUGF0dGVybiwgYElmIHVzaW5nIGEgd2lsZGNhcmQgKCopLCBpdCBtdXN0IGdvIGF0IHRoZSBzdGFydCBvZiB0aGUgaG9zdG5hbWVgKTtcbn1cbi8vI2VuZHJlZ2lvblxuZXhwb3J0IHsgSW52YWxpZE1hdGNoUGF0dGVybiwgTWF0Y2hQYXR0ZXJuIH07XG4iXSwiaWdub3JlTGlzdCI6WzAsMSwyLDVdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7OztDQ2dCQSxJQUFNLFVEZmlCLFdBQVcsU0FBUyxTQUFTLEtBQ2hELFdBQVcsVUFDWCxXQUFXOztDRUZmLFNBQVMsaUJBQWlCLEtBQUs7RUFDOUIsSUFBSSxPQUFPLFFBQVEsT0FBTyxRQUFRLFlBQVksT0FBTyxFQUFFLE1BQU0sSUFBSTtFQUNqRSxPQUFPO0NBQ1I7Ozs7OztDQ0FBLElBQU0sa0NBQWtCLElBQUksSUFBSTtFQUM5QjtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7Q0FDRixDQUFDOzs7Ozs7O0NBUUQsU0FBZ0IsU0FBUyxRQUF3QjtFQUMvQyxJQUFJO0dBQ0YsTUFBTSxTQUFTLElBQUksSUFBSSxNQUFNO0dBQzdCLElBQUksQ0FBQyxPQUFPLFNBQVMsV0FBVyxNQUFNLEdBQUcsT0FBTztHQUVoRCxNQUFNLFdBQVcsT0FBTyxTQUFTLFlBQVksQ0FBQyxDQUFDLFFBQVEsVUFBVSxFQUFFO0dBR25FLElBQUksYUFBYSxpQkFBaUIsYUFBYSxpQkFBaUI7SUFDOUQsSUFBSSxPQUFPLGFBQWEsVUFBVTtLQUNoQyxNQUFNLFVBQVUsT0FBTyxhQUFhLElBQUksR0FBRztLQUMzQyxJQUFJLFNBQ0YsT0FBTyxtQ0FBbUM7SUFFOUM7SUFFQSxJQUFJLE9BQU8sU0FBUyxXQUFXLFVBQVUsR0FBRztLQUUxQyxNQUFNLEtBRFEsT0FBTyxTQUFTLE1BQU0sR0FDekIsQ0FBQSxDQUFNO0tBQ2pCLElBQUksSUFDRixPQUFPLG1DQUFtQztJQUU5QztHQUNGLE9BQU8sSUFBSSxhQUFhLFlBQVk7SUFFbEMsTUFBTSxLQUFLLE9BQU8sU0FBUyxRQUFRLE9BQU8sRUFBRSxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMs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