import './App.css';
import Container from './comp/container';

interface Props {
  text: string | null;
  subgroups: Props[] | null;
  level: number;
  style?: string;
}

function App() {
  // 👇 Example nested structure
  const nestedData: Props = {
    text: "Drinks",
    level: 0,
    style: "",
    subgroups: [
      {
        text: "Milk",
        level: 1,
        style: "",
        subgroups: null,
      },
      {
        text: "Water",
        level: 1,
        style: "",
        subgroups: [
          {
            text: "Sparkling",
            level: 2,
            style: "",
            subgroups: null,
          },
          {
            text: "Still",
            level: 2,
            style: "",
            subgroups: null,
          },
        ],
      },
      {
        text: "Coffee",
        level: 1,
        style: "",
        subgroups: null,
      },
    ],
  };

  return (
<div className="max-w-4xl">
      <Container
        text={nestedData.text}
        subgroups={nestedData.subgroups}
        level={nestedData.level}
        style={nestedData.style}
      />
    </div>
  );
}

export default App;
