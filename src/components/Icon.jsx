
export default function Icon({ name, className = '', style, ...props }) {
  return (
    <i className={`fa-solid fa-${name} ${className}`.trim()} style={style} aria-hidden="true" {...props} />
  )
}
