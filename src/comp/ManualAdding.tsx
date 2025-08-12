
import { useState } from "react";
import ErrorContainer from "./ErrorContainer";
import { useNavigate } from "react-router-dom";

const ManualAdd = () => {

    const navhook = useNavigate()

    const [inputValue1, setInputValue1] = useState('');
    const [inputValue2, setInputValue2] = useState('');
    const [inputValue3, setInputValue3] = useState('');
    const [inputValue4, setInputValue4] = useState('');

    const [itemName, setItemName] = useState<string | null>(null);
    const [ean, setEan] = useState<string | null>(null);
    const [count, setCount] = useState<string | null>(null);
    const [subgroups, setSubgroups] = useState<string | null>(null);

    const [errorMessage, setErrorMessage] = useState("")
    const [showErrorBox, setshowErrorBox] = useState(false)


    const handleInputChangeItem = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue1(e.target.value);
        setItemName(e.target.value); 
    };

    const handleInputChangeEan = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue2(e.target.value);
        setEan(e.target.value); 
    };

    const handleInputChangeCount = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue3(e.target.value);
        setCount(e.target.value); 
    };
    
    const handleInputChangeSubgroups = (e: React.ChangeEvent<HTMLInputElement>) => {
        
        setInputValue4(e.target.value);
        console.log("inputValue4: " + inputValue4)
        setSubgroups(e.target.value); 
    };

    const sendRes = () => {

        let currentCount: string = count ? count : '1'
        let currentItemName: string = ""
        let currentSubgroups: string = subgroups ? subgroups : ""
        //let currentEan = ean
        
        if(!itemName){
            console.warn("no item name supplied")
            setErrorMessage("you havent supplied the necessary item name")
            setshowErrorBox(true)

            setTimeout(() => {
                setshowErrorBox(false)
            }, 2500);

        }
        else{
            currentItemName = itemName
        }
        if(!ean){
            console.warn("no ean supplied")
            setEan("none")
        }
        if(!subgroups){
            console.warn("no subgroups supplied")
            setSubgroups("none")
            currentSubgroups = "none"
        }
        if(!count){
            console.warn("no count supplied")
            setCount('1')
            currentCount = '1'
            setTimeout(() => {
                
            }, 50);
        }

        console.log("ean: " + ean + " item name: " + itemName + " subgroups: " + subgroups + " count: " + currentCount)
        console.log("'" + currentSubgroups + "'")
        
        if(currentItemName && currentCount && currentSubgroups && currentCount ? (parseInt(currentCount) > 0) : false) {
            console.log("now sending to this endpoint with this url: " + 
            `/api/add_ean_to_list_manual/?item_name=${encodeURIComponent(currentItemName)}&subgroups=${currentSubgroups}&count=${encodeURIComponent(currentCount)}`)

            fetch(`/api/add_ean_to_list_manual/?item_name=${encodeURIComponent(currentItemName)}&subgroups=${currentSubgroups}&count=${encodeURIComponent(currentCount)}`)

            navhook("/")
        }
    }

    return (
        <div className="">
            <div className="mb-4">

            {showErrorBox ? <ErrorContainer text={errorMessage} /> : <></> }
                <input
                    type="text"
                    value={inputValue1}
                    onChange={handleInputChangeItem}
                    placeholder="item name"
                    className="my-3  bg-gray-800 w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <input
                    type="text"
                    value={inputValue2}
                    onChange={handleInputChangeEan}
                    placeholder="ean"
                    className="my-3  bg-gray-800 w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <input
                    type="text"
                    value={inputValue3}
                    onChange={handleInputChangeCount}
                    placeholder="count (default = 1)"
                    className="my-3  bg-gray-800 w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />

                <input
                    type="text"
                    value={inputValue4}
                    onChange={handleInputChangeSubgroups}
                    placeholder="subgroups"
                    className="my-3  bg-gray-800 w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />

                <button onClick={sendRes}>submit</button>
            </div>
        </div>
    );
};

export default ManualAdd;