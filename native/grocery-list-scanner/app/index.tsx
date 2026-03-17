import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as React from "react";
import WebComp from "./comp/Web";
import Scanner from "./Scanner";

const Stack = createNativeStackNavigator();

function RootStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="web" component={WebComp} />
      <Stack.Screen
        name="scanner"
        component={Scanner}
        options={{
          headerBackVisible: false,
          headerLeft: () => null,
          gestureEnabled: false,
        }}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  return <RootStack />;
}
