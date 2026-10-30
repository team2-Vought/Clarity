import logoStill from '../../assets/Clarity_logo_8.svg';
import logoThinking from '../../assets/logo-thinking.svg';

// сталі елементи: ThoughtLine перезапускає анімації гліфа, коли той змінюється
export const THINKING_GLYPH = <img className="chat__thought-logo" src={logoThinking} alt="" />;
// завершений аналіз, а також «Менше анімації» в налаштуваннях: туди не дістає
// до анімації всередині <img>
export const STILL_GLYPH = <img className="chat__thought-logo chat__thought-logo--still" src={logoStill} alt="" />;
