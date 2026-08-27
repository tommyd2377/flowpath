import {
  faGithub,
  faLinkedin,
  faTelegram,
  faXTwitter,
} from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

function WebsiteIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.92 6h-3.07a15.7 15.7 0 0 0-1.38-3.22A8.05 8.05 0 0 1 18.92 8ZM12 4c.9 1.08 1.55 2.42 1.91 4h-3.82C10.45 6.42 11.1 5.08 12 4ZM4.26 14a7.9 7.9 0 0 1 0-4h3.4a17.5 17.5 0 0 0 0 4h-3.4Zm.82 2h3.07c.3 1.16.76 2.24 1.38 3.22A8.05 8.05 0 0 1 5.08 16Zm3.07-8H5.08a8.05 8.05 0 0 1 4.45-3.22A15.7 15.7 0 0 0 8.15 8ZM12 20c-.9-1.08-1.55-2.42-1.91-4h3.82c-.36 1.58-1.01 2.92-1.91 4Zm2.23-6H9.77a15.4 15.4 0 0 1 0-4h4.46a15.4 15.4 0 0 1 0 4Zm.24 5.22c.62-.98 1.08-2.06 1.38-3.22h3.07a8.05 8.05 0 0 1-4.45 3.22ZM16.34 14a17.5 17.5 0 0 0 0-4h3.4a7.9 7.9 0 0 1 0 4h-3.4Z"
        fill="currentColor"
      />
    </svg>
  );
}

function MadeWithLoveHeart() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="footer-heart">
      <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />
    </svg>
  );
}

const socialLinks = [
  { href: "https://x.com/thomasfdevito", label: "Thomas DeVito on X", icon: faXTwitter },
  { href: "https://t.me/doubting_tom", label: "Thomas DeVito on Telegram", icon: faTelegram },
  { href: "https://www.linkedin.com/in/tdevito", label: "Thomas DeVito on LinkedIn", icon: faLinkedin },
  { href: "https://github.com/tommyd2377", label: "Thomas DeVito on GitHub", icon: faGithub },
] as const;

export function PersonalFooter() {
  return (
    <footer className="personal-footer">
      <p className="presented-by">Presented by Thomas DeVito</p>
      <nav className="footer-links" aria-label="Thomas DeVito links">
        <a href="https://thomasdevito.me/" target="_blank" rel="noopener noreferrer" aria-label="Thomas DeVito website">
          <WebsiteIcon />
        </a>
        {socialLinks.map((link) => (
          <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" aria-label={link.label}>
            <FontAwesomeIcon icon={link.icon} />
          </a>
        ))}
      </nav>
      <p className="made-in-nyc">
        <span>Made with</span>
        <MadeWithLoveHeart />
        <span>in NYC</span>
      </p>
    </footer>
  );
}
