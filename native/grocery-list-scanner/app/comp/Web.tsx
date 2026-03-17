import { useNavigation } from "@react-navigation/native";
import React from "react";
import { WebView } from "react-native-webview";

interface Props {}

const injectedNavigationListener = `
  (function () {
    var notify = function () {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(window.location.href);
      }
    };

    var wrap = function (method) {
      var original = history[method];
      history[method] = function () {
        var result = original.apply(this, arguments);
        notify();
        return result;
      };
    };

    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", notify);
  })();
  true;
`;

export default function WebComp({}: Props) {
  const navigation = useNavigation<any>();
  const lastHandledUrlRef = React.useRef<string | null>(null);

  const openNativeScannerIfNeeded = (url: string) => {
    if (url.includes("/scanner")) {
      lastHandledUrlRef.current = url;
      console.log("now going to the native scanner component");
      navigation.navigate("scanner");
      return true;
    }

  };

  return (
    <WebView
      source={{ uri: "https://boldo.ddns.net" }}
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
        openNativeScannerIfNeeded(event.nativeEvent.data);
      }}
      injectedJavaScript={injectedNavigationListener}
      style={{ flex: 1 }}
    />
  );
}
