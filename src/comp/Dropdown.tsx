import Dropdown from 'react-bootstrap/Dropdown';

interface Props {
  elements: string[];
  onClick: (element: string) => void;
}

const DropdownComp = ({ elements, onClick }: Props) => {
  return (
    <Dropdown>
      <Dropdown.Toggle variant="success" id="dropdown-basic">
        Groups
      </Dropdown.Toggle>

      <Dropdown.Menu>
        {elements.map((element: string, index: number) => (
          <Dropdown.Item key={index} onClick={() => onClick(element)}>
            {element}
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
};

export default DropdownComp;
