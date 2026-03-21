import { useFocusEffect, useNavigation } from "@react-navigation/native";
import React from "react";
import { WebView } from "react-native-webview";
import { useAuthSession } from "../../lib/AuthSession";
import { MOBILE_WEB_BASE_URL } from "../../lib/config";

const buildInjectedBridgeScript = (jwtToken: string | null, username: string | null) => `
  (function () {
    var normalize = function (value) {
      if (value === null || value === undefined || value === "null" || value === "undefined") {
        return null;
      }
      return String(value);
    };

    var upsertAuthStorage = function (key, nextValue) {
      var currentValue = localStorage.getItem(key);
      if (nextValue === null) {
        if (currentValue !== null) {
          localStorage.removeItem(key);
        }
        return;
      }

      if (currentValue !== nextValue) {
        localStorage.setItem(key, nextValue);
      }
    };

    upsertAuthStorage("jwt_auth", normalize(${JSON.stringify(jwtToken)}));
    upsertAuthStorage("username", normalize(${JSON.stringify(username)}));

    var getAuthHeaderValue = function () {
      var token = normalize(localStorage.getItem("jwt_auth"));
      if (token === null) {
        return null;
      }
      return token.indexOf("Bearer ") === 0 ? token : "Bearer " + token;
    };

    var shouldAttachAuth = function (rawUrl) {
      try {
        var parsed = new URL(rawUrl || window.location.href, window.location.href);
        if (parsed.origin !== window.location.origin) {
          return false;
        }

        var path = parsed.pathname || "";
        if (path.indexOf("/api/") === 0) {
          return true;
        }

        // Legacy routes used by older bundles/routes that bypass /api prefix.
        if (
          path.indexOf("/fetch_") === 0 ||
          path.indexOf("/add_") === 0 ||
          path.indexOf("/change_password") === 0 ||
          path.indexOf("/transcribe") === 0
        ) {
          return true;
        }

        return false;
      } catch (_) {
        return false;
      }
    };

    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      var requestUrl = typeof input === "string" ? input : (input && input.url ? input.url : "");
      var authHeaderValue = getAuthHeaderValue();

      if (!authHeaderValue || !shouldAttachAuth(requestUrl)) {
        return originalFetch.apply(this, arguments);
      }

      var nextInit = init ? Object.assign({}, init) : {};
      var inheritedHeaders = nextInit.headers || (input && input.headers ? input.headers : undefined);
      var headers = new Headers(inheritedHeaders);

      if (!headers.has("Authorization")) {
        headers.set("Authorization", authHeaderValue);
      }

      nextInit.headers = headers;

      if (typeof Request !== "undefined" && input instanceof Request) {
        return originalFetch.call(this, new Request(input, nextInit));
      }

      return originalFetch.call(this, input, nextInit);
    };

    if (typeof XMLHttpRequest !== "undefined") {
      var originalXhrOpen = XMLHttpRequest.prototype.open;
      var originalXhrSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (method, url) {
        this.__attachAuthHeader = shouldAttachAuth(String(url || ""));
        return originalXhrOpen.apply(this, arguments);
      };

      XMLHttpRequest.prototype.send = function () {
        if (this.__attachAuthHeader) {
          var xhrAuthHeaderValue = getAuthHeaderValue();
          if (xhrAuthHeaderValue) {
            try {
              this.setRequestHeader("Authorization", xhrAuthHeaderValue);
            } catch (_) {
              // no-op
            }
          }
        }

        return originalXhrSend.apply(this, arguments);
      };
    }

    var notify = function (reason) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: reason || "navigation",
          url: window.location.href,
          jwt: localStorage.getItem("jwt_auth"),
          username: localStorage.getItem("username")
        }));
      }
    };

    var wrap = function (method) {
      var original = history[method];
      history[method] = function () {
        var result = original.apply(this, arguments);
        notify("navigation");
        return result;
      };
    };

    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", function () { notify("navigation"); });

    var originalSetItem = localStorage.setItem;
    localStorage.setItem = function () {
      originalSetItem.apply(this, arguments);
      if (arguments[0] === "jwt_auth" || arguments[0] === "username") {
        notify("storage");
      }
    };

    var originalRemoveItem = localStorage.removeItem;
    localStorage.removeItem = function () {
      originalRemoveItem.apply(this, arguments);
      if (arguments[0] === "jwt_auth" || arguments[0] === "username") {
        notify("storage");
      }
    };

    notify("init");
  })();
  true;
`;

export default function WebComp() {
  const navigation = useNavigation<any>();
  const { isRestored, jwtToken, setSession, username } = useAuthSession();
  const lastHandledUrlRef = React.useRef<string | null>(null);
  const [focusNonce, setFocusNonce] = React.useState(0);

  const injectedBridgeScript = React.useMemo(
    () => buildInjectedBridgeScript(jwtToken, username),
    [jwtToken, username],
  );

  const openNativeScannerIfNeeded = React.useCallback((url: string) => {
    if (url.includes("/scanner")) {
      if (lastHandledUrlRef.current === url) {
        return true;
      }

      lastHandledUrlRef.current = url;
      console.log("now going to the native scanner component");
      navigation.navigate("scanner");
      return true;
    }

    return false;
  }, [navigation]);

  const onBridgeMessage = React.useCallback((rawData: string) => {
    try {
      const parsed = JSON.parse(rawData) as {
        url?: string;
        jwt?: string | null;
        username?: string | null;
      };

      if (typeof parsed.jwt !== "undefined" || typeof parsed.username !== "undefined") {
        setSession(parsed.jwt ?? null, parsed.username ?? null);
      }

      if (parsed.url) {
        openNativeScannerIfNeeded(parsed.url);
      }

      return;
    } catch {
      // Older non-JSON bridge messages can still be plain URLs.
    }

    openNativeScannerIfNeeded(rawData);
  }, [openNativeScannerIfNeeded, setSession]);

  useFocusEffect(
    React.useCallback(() => {
      if (!isRestored) {
        return;
      }
      setFocusNonce((prev) => prev + 1);
    }, [isRestored]),
  );

  if (!isRestored) {
    return null;
  }

  const webViewAuthKey = `${jwtToken ?? "null"}|${username ?? "null"}|${focusNonce}`;

  return (
    <WebView
      key={webViewAuthKey}
      source={{ uri: MOBILE_WEB_BASE_URL }}
      onShouldStartLoadWithRequest={(request) => {
        if (openNativeScannerIfNeeded(request.url)) {
          return false;
        }
        return true;
      }}
      onNavigationStateChange={(navState) => {
        openNativeScannerIfNeeded(navState.url);
      }}
      onMessage={(event) => {
        onBridgeMessage(event.nativeEvent.data);
      }}
      injectedJavaScriptBeforeContentLoaded={injectedBridgeScript}
      style={{ flex: 1 }}
    />
  );
}
