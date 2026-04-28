const InfoContainer = ({ text }: { text: string }) => (
  <div className="info-container">
    <div className="info-container__icon">🛒</div>
    {text}
  </div>
);
export default InfoContainer;
