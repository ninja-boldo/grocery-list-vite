import { memo } from 'react';

interface SidebarCompProps {
    isOpen: boolean;
    onClose: () => void;
}

const SidebarComp = ({ isOpen }: SidebarCompProps) => {
    return (
        <div className={`
            fixed top-0 left-0 h-full w-64 bg-gradient-to-b from-gray-800 to-gray-900 z-50 
            shadow-2xl transform transition-transform duration-300 ease-in-out
            ${isOpen ? 'translate-x-0' : '-translate-x-full'}
            border-r border-gray-700
        `}>
            {/* Header with close button */}
            <div className="flex items-center justify-between p-6 border-b border-gray-700">
                {/* perhaps add something here in future */}
                
            </div>
            
            {/* Menu items */}
            <div className="px-4 pt-6 space-y-2">
               
                <a 
                    href="/" 
                    className="flex items-center px-4 py-3 text-gray-300 hover:text-white hover:bg-gray-700 hover:bg-opacity-50 rounded-lg transition-all duration-200 group border-l-2 border-transparent hover:border-green-500"
                >
                    <span className="w-2 h-2 bg-green-500 rounded-full mr-3 group-hover:scale-125 transition-transform"></span>
                    item list
                </a>
                 <a 
                    href="/wish_list" 
                    className="flex items-center px-4 py-3 text-gray-300 hover:text-white hover:bg-gray-700 hover:bg-opacity-50 rounded-lg transition-all duration-200 group border-l-2 border-transparent hover:border-blue-500"
                >
                    <span className="w-2 h-2 bg-blue-500 rounded-full mr-3 group-hover:scale-125 transition-transform"></span>
                    wish list
                </a>
                 <a 
                    href="/matched_items" 
                    className="flex items-center px-4 py-3 text-gray-300 hover:text-white hover:bg-gray-700 hover:bg-opacity-50 rounded-lg transition-all duration-200 group border-l-2 border-transparent hover:border-red-500"
                >
                    <span className="w-2 h-2 bg-red-500 rounded-full mr-3 group-hover:scale-125 transition-transform"></span>
                    grouped items
                </a>

                <a 
                    href="/market_mapping" 
                    className="flex items-center px-4 py-3 text-gray-300 hover:text-white hover:bg-gray-700 hover:bg-opacity-50 rounded-lg transition-all duration-200 group border-l-2 border-transparent hover:border-yellow-500"
                >
                    <span className="w-2 h-2 bg-yellow-500 rounded-full mr-3 group-hover:scale-125 transition-transform"></span>
                    close supermarkets
                </a>

                <a 
                    href="/settings" 
                    className="flex items-center px-4 py-3 text-gray-300 hover:text-white hover:bg-gray-700 hover:bg-opacity-50 rounded-lg transition-all duration-200 group border-l-2 border-transparent hover:border-purple-500"
                >
                    <span className="w-2 h-2 bg-purple-500 rounded-full mr-3 group-hover:scale-125 transition-transform"></span>
                    settings
                </a>
            </div>
        </div>
    );
};

export default memo(SidebarComp);