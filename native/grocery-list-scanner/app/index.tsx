import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as React from "react";
import Auth from "./Auth";
import { AuthSessionProvider } from "../lib/AuthSession";
import { MOBILE_USE_WEBVIEW_AUTH } from "../lib/config";
import WebComp from "./comp/Web";
import Scanner from "./Scanner";

const Stack = createNativeStackNavigator();

function RootStack() {
  return (
    <Stack.Navigator
      initialRouteName={MOBILE_USE_WEBVIEW_AUTH ? "web" : "auth"}
      screenOptions={{ headerShown: false }}
    >
      {!MOBILE_USE_WEBVIEW_AUTH && (
        <Stack.Screen
          name="auth"
          component={Auth}
          options={{
            gestureEnabled: false,
          }}
        />
      )}
      <Stack.Screen name="web" component={WebComp} />
      <Stack.Screen
        name="scanner"
        component={Scanner}
        options={{
          gestureEnabled: false,
        }}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthSessionProvider>
      <RootStack />
    </AuthSessionProvider>
  );
}
