'use client';
import Link from 'next/link';

export default function NotFound() {
    return (
        <div className="error-page">
            <style>{`
                .error-page {
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    background: #050505;
                    color: white;
                    font-family: 'Segoe UI', Roboto, sans-serif;
                    overflow: hidden;
                    text-align: center;
                }

                .error-code {
                    font-size: 150px;
                    font-weight: 900;
                    margin: 0;
                    position: relative;
                    color: #fff;
                    text-shadow: 0.05em 0 0 rgba(255, 0, 0, 0.75),
                                -0.025em -0.05em 0 rgba(0, 255, 0, 0.75),
                                0.025em 0.05em 0 rgba(0, 0, 255, 0.75);
                    animation: glitch 500ms infinite;
                }

                .error-code span {
                    position: absolute;
                    top: 0;
                    left: 0;
                }

                .msg {
                    font-size: 1.2rem;
                    opacity: 0.7;
                    margin-bottom: 30px;
                    max-width: 400px;
                }

                .parrot-icon {
                    font-size: 50px;
                    margin-bottom: 20px;
                    filter: drop-shadow(0 0 10px #0070f3);
                }

                .back-btn {
                    padding: 12px 25px;
                    background: #0070f3;
                    color: white;
                    text-decoration: none;
                    border-radius: 12px;
                    font-weight: 600;
                    transition: 0.3s;
                    border: 1px solid transparent;
                }

                .back-btn:hover {
                    background: transparent;
                    border-color: #0070f3;
                    box-shadow: 0 0 20px rgba(0, 112, 243, 0.4);
                }

                @keyframes glitch {
                    0% { text-shadow: 0.05em 0 0 rgba(255, 0, 0, 0.75), -0.025em -0.05em 0 rgba(0, 255, 0, 0.75), 0.025em 0.05em 0 rgba(0, 0, 255, 0.75); }
                    14% { text-shadow: 0.05em 0 0 rgba(255, 0, 0, 0.75), -0.025em -0.05em 0 rgba(0, 255, 0, 0.75), 0.025em 0.05em 0 rgba(0, 0, 255, 0.75); }
                    15% { text-shadow: -0.05em -0.025em 0 rgba(255, 0, 0, 0.75), 0.025em 0.025em 0 rgba(0, 255, 0, 0.75), -0.05em -0.05em 0 rgba(0, 0, 255, 0.75); }
                    49% { text-shadow: -0.05em -0.025em 0 rgba(255, 0, 0, 0.75), 0.025em 0.025em 0 rgba(0, 255, 0, 0.75), -0.05em -0.05em 0 rgba(0, 0, 255, 0.75); }
                    50% { text-shadow: 0.025em 0.05em 0 rgba(255, 0, 0, 0.75), 0.05em 0 0 rgba(0, 255, 0, 0.75), 0 -0.05em 0 rgba(0, 0, 255, 0.75); }
                    99% { text-shadow: 0.025em 0.05em 0 rgba(255, 0, 0, 0.75), 0.05em 0 0 rgba(0, 255, 0, 0.75), 0 -0.05em 0 rgba(0, 0, 255, 0.75); }
                    100% { text-shadow: -0.025em 0 0 rgba(255, 0, 0, 0.75), -0.025em -0.025em 0 rgba(0, 255, 0, 0.75), -0.025em -0.05em 0 rgba(0, 0, 255, 0.75); }
                }

                .bg-dots {
                    position: absolute;
                    inset: 0;
                    background-image: radial-gradient(#111 1px, transparent 1px);
                    background-size: 20px 20px;
                    z-index: -1;
                }
            `}</style>

            <div className="bg-dots"></div>
            <div className="parrot-icon">🦜</div>
            <h1 className="error-code">404</h1>
            <p className="msg">
                ParrotSoft Critical Error: The requested memory sector was not found or has been moved to another cloud.
            </p>
            <Link href="/" className="back-btn">
                Return to Home
            </Link>
        </div>
    );
}