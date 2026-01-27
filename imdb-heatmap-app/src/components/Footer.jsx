import { GithubLogo } from '@phosphor-icons/react'

const Footer = () => {
    return (
        <footer className="border-t border-border mt-8" role="contentinfo">
            <div className="max-w-[1400px] mx-auto px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm text-text-muted">
                <span>Built by Mihik</span>
                <a
                    href="https://github.com/Mihik197"
                    target="_blank"
                    rel="noreferrer"
                    aria-label="GitHub profile"
                    className="inline-flex items-center hover:text-accent transition-colors sm:mr-3"
                >
                    <GithubLogo size={18} weight="fill" />
                </a>
            </div>
        </footer>
    )
}

export default Footer
